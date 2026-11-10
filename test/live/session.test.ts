import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import WebSocketImpl from 'ws';
import { expectRejection } from '../http/helpers.js';
import { END_TIMEOUT_MS } from '../../src/live/session.js';
import type { LiveEvents } from '../../src/live/types.js';
import {
  concatFrames,
  createClient,
  createClock,
  frameOf,
  payloadsOf,
  pcm,
  startApi,
  startManual,
  startSession,
  until,
} from './helpers.js';

const wireLine = (id: number, text: string, final = false, extra: Record<string, unknown> = {}) => ({
  type: 'line',
  line: {
    id,
    start_ms: id * 1000,
    end_ms: (id * 1000) + 900,
    speaker: null,
    language: 'en',
    text,
    final,
    translation: null,
    ...extra,
  },
});

test('started fires with the session details', async t => {
  const started = await startSession(t);
  await until(() => payloadsOf(started, 'started').length === 1);

  assert.deepEqual(payloadsOf(started, 'started'), [{
    sessionId: started.live.id,
    transcriptionId: started.live.transcriptionId,
    resumed: false,
    offsetMs: 0,
  }]);
});

test('line events update lines in place by id and keep them in order', async t => {
  const started = await startSession(t);
  const { live, server } = started;
  server.emit(wireLine(1, 'second draft'));
  server.emit(wireLine(0, 'first', true));
  server.emit(wireLine(1, 'second line', true, { translation: { language: 'es', text: 'segunda línea', final: false } }));
  await until(() => payloadsOf(started, 'line').length === 3);

  assert.equal(live.lines.length, 2);
  assert.deepEqual(live.lines.map(line => line.id), [0, 1]);
  assert.equal(live.lines[0]?.text, 'first');
  assert.equal(live.lines[0]?.final, true);
  assert.deepEqual(live.lines[1], {
    id: 1,
    startMs: 1000,
    endMs: 1900,
    speaker: null,
    language: 'en',
    text: 'second line',
    final: true,
    translation: { language: 'es', text: 'segunda línea', final: false },
  });
  assert.deepEqual(payloadsOf(started, 'line').map(line => line.text), ['second draft', 'first', 'second line']);
});

test('a line already in the target language carries sameLanguage, only when the server sends true', async t => {
  const started = await startSession(t);
  started.server.emit(wireLine(0, 'Hello there.', true, {
    translation: {
      language: 'en', text: 'Hello there.', final: true, same_language: true,
    },
  }));
  started.server.emit(wireLine(1, 'Hola.', true, {
    language: 'es',
    translation: {
      language: 'en', text: 'Hello.', final: true, same_language: false,
    },
  }));
  await until(() => started.live.lines.length === 2);
  const [same, other] = started.live.lines;
  const sameLanguage: boolean | undefined = same?.translation?.sameLanguage;

  assert.equal(sameLanguage, true);
  assert.deepEqual(same?.translation, {
    language: 'en', text: 'Hello there.', final: true, sameLanguage: true,
  });
  assert.deepEqual(other?.translation, { language: 'en', text: 'Hello.', final: true });
});

test('lines keeps the same array while it is updated', async t => {
  const started = await startSession(t);
  const before = started.live.lines;
  started.server.emit(wireLine(0, 'hello'));
  await until(() => before.length === 1);

  assert.equal(started.live.lines, before);
});

test('end sends the end command, resolves with the result and fires ended', async t => {
  const started = await startSession(t);
  const result = await started.live.end();

  assert.deepEqual(result, {
    reason: 'client_ended',
    transcriptionId: started.live.transcriptionId,
    minutesCharged: 1,
    connectedMs: 1500,
    audioMs: 1000,
  });
  assert.deepEqual(payloadsOf(started, 'ended'), [result]);
  assert.deepEqual(started.server.commands, ['{"type":"end"}']);
  await until(() => started.server.closeCode !== undefined);
  assert.equal(started.server.closeCode, 1000);
});

test('end called twice returns the same result and sends one command', async t => {
  const started = await startSession(t);
  const first = started.live.end();
  const second = started.live.end();

  assert.deepEqual(await first, await second);
  // Initial events are released on the next turn so callers can attach listeners after start().
  await until(() => payloadsOf(started, 'ended').length === 1);
  assert.equal(started.server.commands.length, 1);
  assert.equal(payloadsOf(started, 'ended').length, 1);
});

test('balance_exhausted resolves end() and fires ended without throwing', async t => {
  const started = await startSession(t, { liveAutoEnd: false });
  const pending = started.live.end();
  await until(() => started.server.commands.length === 1);
  started.server.finish('balance_exhausted', { minutes_charged: 5 });
  const result = await pending;

  assert.equal(result.reason, 'balance_exhausted');
  assert.equal(result.minutesCharged, 5);
  assert.equal(payloadsOf(started, 'ended')[0]?.reason, 'balance_exhausted');
});

test('a server-side ending resolves a later end() call', async t => {
  const started = await startSession(t, { liveAutoEnd: false });
  started.server.finish('idle_timeout');
  await until(() => payloadsOf(started, 'ended').length === 1);
  const result = await started.live.end();

  assert.equal(result.reason, 'idle_timeout');
  assert.deepEqual(started.server.commands, []);
});

test('send delivers identical bytes for Int16Array, Uint8Array and ArrayBuffer', async t => {
  const started = await startSession(t);
  const samples = pcm(1, -2, 300, -32_768, 32_767, 0);
  const bytes = new Uint8Array(samples.buffer);
  started.live.send(samples);
  started.live.send(bytes);
  started.live.send(Uint8Array.from(bytes).buffer);
  await until(() => started.server.frames.length === 3);
  const [first, second, third] = started.server.frames;

  assert.equal(first?.length, 12);
  assert.ok(first?.equals(Buffer.from(bytes)));
  assert.ok(first?.equals(second ?? Buffer.alloc(0)));
  assert.ok(first?.equals(third ?? Buffer.alloc(0)));
});

test('send respects the offset of a typed array view', async t => {
  const started = await startSession(t);
  const backing = new Int16Array([9, 9, 1, 2, 3, 9]);
  started.live.send(backing.subarray(2, 5));
  await until(() => started.server.frames.length === 1);

  assert.ok(started.server.frames[0]?.equals(Buffer.from(Int16Array.of(1, 2, 3).buffer)));
});

test('send copies the audio so the caller can reuse the buffer', async t => {
  const started = await startSession(t);
  const buffer = pcm(1, 2, 3, 4);
  started.live.send(buffer);
  buffer.fill(0);
  await until(() => started.server.frames.length === 1);

  assert.ok(started.server.frames[0]?.equals(Buffer.from(Int16Array.of(1, 2, 3, 4).buffer)));
});

test('send splits audio into frames of at most 256 KB', async t => {
  const started = await startSession(t);
  started.live.send(frameOf(7, 300_000));
  await until(() => concatFrames(started.server.frames).length === 300_000);

  assert.deepEqual(started.server.frames.map(frame => frame.length), [262_144, 37_856]);
});

test('send rejects audio that is not whole 16-bit samples', async t => {
  const { live, server } = await startSession(t);

  assert.throws(() => {
    live.send(new Uint8Array(3));
  }, { code: 'invalid_input' });
  assert.deepEqual(server.frames, []);
});

test('finalize sends the finalize command', async t => {
  const { live, server } = await startSession(t);
  live.finalize();
  await until(() => server.commands.length === 1);

  assert.deepEqual(server.commands, ['{"type":"finalize"}']);
});

test('usage and warning events map to camelCase with a message', async t => {
  const started = await startSession(t);
  started.server.emit({
    type: 'usage', connected_ms: 61_000, audio_ms: 60_000, minutes_charged: 2, minutes_remaining: 8,
  });
  started.server.emit({ type: 'warning', code: 'balance_low' });
  started.server.emit({ type: 'warning', code: 'something_new' });
  await until(() => payloadsOf(started, 'warning').length === 1);

  assert.deepEqual(payloadsOf(started, 'usage'), [{
    connectedMs: 61_000, audioMs: 60_000, minutesCharged: 2, minutesRemaining: 8,
  }]);
  const [warning] = payloadsOf(started, 'warning');
  assert.equal(warning?.code, 'balance_low');
  assert.ok(warning?.message);
});

test('non-fatal server errors surface as error events and do not end the session', async t => {
  const started = await startSession(t);
  started.server.emit({ type: 'error', code: 'invalid_message', message: 'Unknown message' });
  await until(() => payloadsOf(started, 'error').length === 1);

  assert.deepEqual(payloadsOf(started, 'error'), [{ code: 'invalid_message', message: 'Unknown message' }]);
  assert.deepEqual(payloadsOf(started, 'ended'), []);
  started.live.send(frameOf(1, 10));
  await until(() => started.server.frames.length === 1);
});

test('unknown and malformed server messages are ignored', async t => {
  const started = await startSession(t);
  started.server.emit({ type: 'future.event', value: 1 });
  started.server.socket?.send('not json');
  started.server.socket?.send(Buffer.from([1, 2]));
  started.server.emit(wireLine(0, 'still works'));
  await until(() => payloadsOf(started, 'line').length === 1);

  assert.deepEqual(payloadsOf(started, 'error'), []);
});

test('close code 4004 ends the session as disconnected without reconnecting', async t => {
  const started = await startSession(t);
  started.server.drop(4004);
  await until(() => payloadsOf(started, 'ended').length === 1);
  const result = await started.live.end();

  assert.equal(result.reason, 'disconnected');
  assert.deepEqual(payloadsOf(started, 'reconnecting'), []);
  assert.equal(started.fake.requests.filter(request => request.path.endsWith('/token')).length, 0);
});

test('an invalid token makes start() fail with network_error', async t => {
  class WrongToken extends WebSocketImpl {
    constructor(url: string, protocols: string[]) {
      super(url, [protocols[0] ?? '', 'wrong-token']);
    }
  }

  const fake = await startApi(t);
  const error = await expectRejection(createClient(fake, { WebSocket: WrongToken as unknown as typeof WebSocket }).live.start());

  assert.equal(error.code, 'network_error');
  assert.equal(error.retryable, true);
  assert.match(error.message, /token is invalid/);
  assert.equal(fake.liveSessions.get('lv_1')?.tokenUsed, false);
});

test('end() falls back to disconnected after 30 s, confirmed by one session read', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, { liveAutoEnd: false }, {}, { clock });
  const reads = () => started.fake.requests.filter(request => request.method === 'GET' && request.path === `/v1/live/sessions/${started.live.id}`);
  const pending = started.live.end();
  await until(() => clock.isHeld(END_TIMEOUT_MS));

  assert.equal(reads().length, 0);
  clock.release(END_TIMEOUT_MS);
  const result = await pending;

  assert.deepEqual(result, {
    reason: 'disconnected',
    transcriptionId: started.live.transcriptionId,
    minutesCharged: 1,
    connectedMs: 1500,
    audioMs: 1000,
  });
  assert.equal(reads().length, 1);
  assert.deepEqual(payloadsOf(started, 'ended'), [result]);
});

test('the end() fallback still resolves when the session read fails', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, { liveAutoEnd: false, liveGetError: { status: 404, code: 'not_found' } }, {}, { clock });
  const pending = started.live.end();
  await until(() => clock.isHeld(END_TIMEOUT_MS));
  clock.release(END_TIMEOUT_MS);
  const result = await pending;

  assert.equal(result.reason, 'disconnected');
  assert.equal(result.minutesCharged, 0);
});

test('a session.ended before 30 s cancels the end() fallback', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, { liveAutoEnd: false }, {}, { clock });
  const pending = started.live.end();
  await until(() => clock.isHeld(END_TIMEOUT_MS));
  started.server.finish('client_ended');
  const result = await pending;

  assert.equal(result.reason, 'client_ended');
  assert.equal(clock.isHeld(END_TIMEOUT_MS), false);
  assert.equal(started.fake.requests.filter(request => request.method === 'GET').length, 0);
});

test('send and finalize after the session ended do nothing', async t => {
  const started = await startSession(t);
  await started.live.end();
  started.live.send(frameOf(1, 10));
  started.live.finalize();
  await new Promise(resolve => {
    setTimeout(resolve, 30);
  });

  assert.deepEqual(started.server.frames, []);
  assert.deepEqual(started.server.commands, ['{"type":"end"}']);
});

test('on returns an unsubscribe function', async t => {
  const started = await startSession(t);
  const seen: number[] = [];
  const off = started.live.on('line', line => {
    seen.push(line.id);
  });
  started.server.emit(wireLine(0, 'a'));
  await until(() => seen.length === 1);
  off();
  started.server.emit(wireLine(1, 'b'));
  await until(() => started.live.lines.length === 2);

  assert.deepEqual(seen, [0]);
});

test('no live source file imports a node module', async () => {
  const { readdir, readFile } = await import('node:fs/promises');
  const directory = new URL('../../src/live/', import.meta.url);
  const names = await readdir(directory);
  assert.ok(names.length >= 6);
  for (const name of names) {
    // eslint-disable-next-line no-await-in-loop
    const source = await readFile(new URL(name, directory), 'utf8');
    assert.doesNotMatch(source, /from '(?:node:|fs|path|http|net|crypto)/, `${name} imports a node module`);
  }
});

test('an empty provisional line leaves lines but still reaches line handlers', async t => {
  const started = await startSession(t);
  const { live, server } = started;
  server.emit(wireLine(0, 'first', true));
  server.emit(wireLine(2, 'cut head'));
  server.emit(wireLine(3, 'next'));
  server.emit(wireLine(2, ''));
  server.emit(wireLine(7, ''));
  await until(() => payloadsOf(started, 'line').length === 5);

  assert.deepEqual(live.lines.map(line => [line.id, line.text]), [[0, 'first'], [3, 'next']]);
  assert.deepEqual(payloadsOf(started, 'line').slice(3).map(line => [line.id, line.text, line.final]), [[2, '', false], [7, '', false]]);

  server.emit(wireLine(5, 'later'));
  server.emit(wireLine(3, 'next line'));
  server.emit(wireLine(9, '', true));
  await until(() => payloadsOf(started, 'line').length === 8);

  assert.deepEqual(live.lines.map(line => [line.id, line.text]), [[0, 'first'], [3, 'next line'], [5, 'later'], [9, '']]);
});

const startWithBoundaries = async (t: TestContext) => {
  const { server, pending } = await startManual(t, { sampleRate: 8000 });
  server.start({ caption_boundaries: true });
  const live = await pending;
  const started: Array<LiveEvents['started']> = [];
  live.on('started', payload => {
    started.push(payload);
  });
  const log: unknown[] = [];
  server.socket?.on('message', (data: Buffer, isBinary: boolean) => {
    log.push(isBinary ? data.byteLength : JSON.parse(data.toString('utf8')));
  });

  return {
    live, server, started, log,
  };
};

test('sends caption.boundary in order with audio only when advertised', async t => {
  const { live, started, log } = await startWithBoundaries(t);
  await until(() => started.length === 1);
  assert.equal(started[0]?.captionBoundaries, true);
  // 8000 Hz: 1600 bytes is 100 ms
  live.send(frameOf(1, 1600));
  assert.equal(live.boundary(150), true);
  live.send(frameOf(2, 1600));
  await until(() => log.length === 3);

  assert.deepEqual(log, [1600, { type: 'caption.boundary', audio_ms: 150 }, 1600]);
  await live.end();
});

test('returns false and sends nothing without the flag', async t => {
  const started = await startSession(t);
  await until(() => payloadsOf(started, 'started').length === 1);
  assert.equal(payloadsOf(started, 'started')[0]?.captionBoundaries, undefined);
  assert.equal(started.live.boundary(10), false);
  await started.live.end();

  assert.deepEqual(started.server.commands, ['{"type":"end"}']);
});

test('rejects a non-integer or negative boundary', async t => {
  const { live, server } = await startWithBoundaries(t);
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => {
      live.boundary(value);
    }, RangeError);
  }

  await live.end();
  assert.deepEqual(server.commands, ['{"type":"end"}']);
});

test('returns false once the session is ending or finished', async t => {
  const { live, server } = await startWithBoundaries(t);
  const ending = live.end();
  assert.equal(live.boundary(0), false);
  await ending;
  assert.equal(live.boundary(0), false);

  assert.deepEqual(server.commands, ['{"type":"end"}']);
});

const startWithSwitch = async (t: TestContext) => {
  const { server, pending } = await startManual(t, { sampleRate: 8000 });
  server.start({ translation_switch: true });
  const live = await pending;
  const started: Array<LiveEvents['started']> = [];
  live.on('started', payload => {
    started.push(payload);
  });
  const log: unknown[] = [];
  server.socket?.on('message', (data: Buffer, isBinary: boolean) => {
    log.push(isBinary ? data.byteLength : JSON.parse(data.toString('utf8')));
  });

  return {
    live, server, started, log,
  };
};

test('sends translation.set in order with audio only when advertised', async t => {
  const { live, started, log } = await startWithSwitch(t);
  await until(() => started.length === 1);
  assert.equal(started[0]?.translationSwitch, true);
  live.send(frameOf(1, 1600));
  assert.equal(live.translate('pl'), true);
  live.send(frameOf(2, 1600));
  assert.equal(live.translate(null), true);
  await until(() => log.length === 4);

  assert.deepEqual(log, [1600, { type: 'translation.set', translate_to: 'pl' }, 1600, { type: 'translation.set', translate_to: null }]);
  await live.end();
});

test('translate returns false and sends nothing without the flag', async t => {
  const started = await startSession(t);
  await until(() => payloadsOf(started, 'started').length === 1);
  assert.equal(payloadsOf(started, 'started')[0]?.translationSwitch, undefined);
  assert.equal(started.live.translate('pl'), false);
  await started.live.end();

  assert.deepEqual(started.server.commands, ['{"type":"end"}']);
});

test('translate rejects anything but null or a non-empty string', async t => {
  const { live, server } = await startWithSwitch(t);
  for (const value of ['', undefined, 1, {}]) {
    assert.throws(() => {
      live.translate(value as string);
    }, TypeError);
  }

  await live.end();
  assert.deepEqual(server.commands, ['{"type":"end"}']);
});

test('translate returns false once the session is ending or finished', async t => {
  const { live, server } = await startWithSwitch(t);
  const ending = live.end();
  assert.equal(live.translate('pl'), false);
  await ending;
  assert.equal(live.translate(null), false);

  assert.deepEqual(server.commands, ['{"type":"end"}']);
});

test('an unsupported_translation warning reaches warning handlers with its typed code', async t => {
  const started = await startSession(t);
  started.server.emit({ type: 'warning', code: 'unsupported_translation' });
  await until(() => payloadsOf(started, 'warning').length === 1);

  const [warning] = payloadsOf(started, 'warning');
  const code: LiveEvents['warning']['code'] = 'unsupported_translation';
  assert.equal(warning?.code, code);
  assert.ok(warning?.message);
});
