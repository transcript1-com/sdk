import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocketImpl from 'ws';
import {
  concatFrames,
  createClient,
  frameOf,
  payloadsOf,
  pcm,
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

test('send holds audio until the server has started the session, then flushes it in order', async t => {
  const started = await startSession(t, { liveManualStart: true });
  const { live, server } = started;
  live.send(frameOf(1, 100));
  live.send(frameOf(2, 100));
  live.finalize();
  live.send(frameOf(3, 100));
  await new Promise(resolve => {
    setTimeout(resolve, 50);
  });

  assert.deepEqual(server.frames, []);
  assert.deepEqual(server.commands, []);

  server.start();
  await until(() => server.frames.length === 3 && server.commands.length === 1);

  assert.deepEqual(server.frames.map(frame => frame[0]), [1, 2, 3]);
  assert.deepEqual(server.commands, ['{"type":"finalize"}']);
  live.send(frameOf(4, 100));
  await until(() => server.frames.length === 4);
});

test('held audio keeps only the last 10 seconds', async t => {
  // 8000 Hz: 10 s is 160000 bytes
  const started = await startSession(t, { liveManualStart: true }, { sampleRate: 8000 });
  const { live, server } = started;
  for (let index = 0; index < 15; index++) {
    live.send(frameOf(index + 1, 16_000));
  }

  server.start();
  await until(() => concatFrames(server.frames).length === 160_000);

  assert.deepEqual(server.frames.map(frame => frame[0]), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('held audio trims part of the oldest frame on an even boundary', async t => {
  const started = await startSession(t, { liveManualStart: true }, { sampleRate: 8000 });
  const { live, server } = started;
  live.send(frameOf(1, 100_000));
  live.send(frameOf(2, 100_000));
  server.start();
  await until(() => concatFrames(server.frames).length === 160_000);

  assert.deepEqual(server.frames.map(frame => [frame[0], frame.length]), [[1, 60_000], [2, 100_000]]);
});

test('end before the session has started flushes the held audio and then ends', async t => {
  const started = await startSession(t, { liveManualStart: true });
  const { live, server } = started;
  live.send(frameOf(1, 100));
  const pending = live.end();
  server.start();
  const result = await pending;

  assert.equal(result.reason, 'client_ended');
  assert.equal(server.frames.length, 1);
  assert.deepEqual(server.commands, ['{"type":"end"}']);
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

test('a close without session.ended ends the session as disconnected', async t => {
  const started = await startSession(t);
  started.server.emit({
    type: 'usage', connected_ms: 5000, audio_ms: 4000, minutes_charged: 1, minutes_remaining: 9,
  });
  await until(() => payloadsOf(started, 'usage').length === 1);
  started.server.drop(1006);
  const result = await started.live.end();

  assert.deepEqual(result, {
    reason: 'disconnected',
    transcriptionId: started.live.transcriptionId,
    minutesCharged: 1,
    connectedMs: 5000,
    audioMs: 4000,
  });
  assert.deepEqual(payloadsOf(started, 'ended'), [result]);
});

test('an invalid token ends the session as disconnected', async t => {
  class WrongToken extends WebSocketImpl {
    constructor(url: string, protocols: string[]) {
      super(url, [protocols[0] ?? '', 'wrong-token']);
    }
  }

  const started = await startSession(t, {}, {}, {
    client: fake => createClient(fake, { WebSocket: WrongToken as unknown as typeof WebSocket }),
    waitForServer: false,
  });
  const result = await started.live.end();

  assert.equal(result.reason, 'disconnected');
  assert.equal(started.server.tokenUsed, false);
});

test('close code 4004 ends the session as disconnected', async t => {
  const started = await startSession(t);
  started.server.drop(4004);
  const result = await started.live.end();

  assert.equal(result.reason, 'disconnected');
});

test('a reconnect event is surfaced and the following 1012 close ends the session', async t => {
  const started = await startSession(t);
  started.server.emit({ type: 'reconnect', reason: 'server_restart' });
  started.server.drop(1012);
  const result = await started.live.end();

  assert.equal(payloadsOf(started, 'reconnecting').length, 1);
  assert.equal(result.reason, 'disconnected');
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
