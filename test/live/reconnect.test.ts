import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { createLiveClient } from '../../src/live/index.js';
import { END_TIMEOUT_MS } from '../../src/live/session.js';
import {
  concatFrames,
  createClock,
  frameOf,
  payloadsOf,
  startApi,
  startManual,
  startSession,
  until,
} from './helpers.js';

const tokenRequests = (requests: Array<{ method: string; path: string }>) => requests.filter(request => request.method === 'POST' && request.path.endsWith('/token'));

const settleFor = async (ms: number) => new Promise(resolve => {
  setTimeout(resolve, ms);
});

test('a drop fires reconnecting then reconnected, asks for a new token and replays the gap in order', async t => {
  const clock = createClock([500, END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { fake, live, server } = started;
  const firstToken = server.token;
  server.drop(1006);
  await until(() => clock.isHeld(500));
  live.send(frameOf(1, 100));
  live.send(frameOf(2, 100));
  live.finalize();
  live.send(frameOf(3, 100));
  fake.knobs.liveManualStart = true;
  clock.release(500);
  await until(() => server.connections === 2 && server.socket?.readyState === 1);
  await settleFor(40);

  assert.deepEqual(server.frames, [], 'nothing is replayed before session.started');
  assert.deepEqual(server.commands, []);
  server.start({ offset_ms: 4200 });
  await until(() => server.frames.length === 3 && server.commands.length === 1);

  assert.deepEqual(server.frames.map(frame => frame[0]), [1, 2, 3]);
  assert.deepEqual(server.commands, ['{"type":"finalize"}']);
  assert.equal(tokenRequests(fake.requests).length, 1);
  assert.notEqual(server.token, firstToken);
  assert.equal(server.protocols[1], server.token);
  assert.deepEqual(clock.delays, [500]);
  await until(() => payloadsOf(started, 'reconnected').length === 1);
  assert.deepEqual(payloadsOf(started, 'reconnecting'), [{ attempt: 1 }]);
  assert.deepEqual(payloadsOf(started, 'reconnected'), [{}]);
  assert.deepEqual(payloadsOf(started, 'started').map(event => [event.resumed, event.offsetMs]), [[false, 0], [true, 4200]]);
  const names = started.events.filter(event => event.name === 'reconnecting' || event.name === 'reconnected').map(event => event.name);
  assert.deepEqual(names, ['reconnecting', 'reconnected']);

  live.send(frameOf(4, 100));
  await until(() => server.frames.length === 4);
  const result = await live.end();

  assert.equal(result.reason, 'client_ended');
});

test('a server reconnect event reconnects immediately and keeps the session', async t => {
  const clock = createClock();
  const started = await startSession(t, {}, {}, { clock });
  const { fake, live, server } = started;
  server.emit({ type: 'reconnect', reason: 'server_restart' });
  await until(() => payloadsOf(started, 'reconnected').length === 1);

  assert.deepEqual(clock.delays, []);
  assert.equal(tokenRequests(fake.requests).length, 1);
  assert.equal(server.connections, 2);
  assert.deepEqual(payloadsOf(started, 'reconnecting'), [{ attempt: 1 }]);
  assert.deepEqual(payloadsOf(started, 'ended'), []);
  live.send(frameOf(1, 10));
  await until(() => server.frames.length === 1);
  const result = await live.end();

  assert.equal(result.reason, 'client_ended');
  assert.equal(payloadsOf(started, 'reconnecting').length, 1);
});

test('the 1012 close that follows a reconnect event does not start a second reconnect', async t => {
  const clock = createClock();
  const started = await startSession(t, {}, { sampleRate: 8000 }, { clock });
  const { live, server } = started;
  server.emit({ type: 'reconnect', reason: 'server_restart' });
  server.drop(1012);
  await until(() => payloadsOf(started, 'reconnected').length === 1);
  live.send(frameOf(1, 10));
  await until(() => server.frames.length === 1);
  const result = await live.end();

  assert.equal(result.reason, 'client_ended');
  assert.equal(payloadsOf(started, 'reconnecting').length, 1);
  assert.equal(server.connections, 2);
});

test('the gap buffer keeps only the last 10 seconds', async t => {
  // 8000 Hz: 10 s is 160000 bytes
  const clock = createClock([500]);
  const { fake, live, server } = await startSession(t, {}, { sampleRate: 8000 }, { clock });
  server.drop(1006);
  await until(() => clock.isHeld(500));
  for (let index = 0; index < 15; index++) {
    live.send(frameOf(index + 1, 16_000));
  }

  fake.knobs.liveManualStart = true;
  clock.release(500);
  await until(() => server.connections === 2 && server.socket?.readyState === 1);
  server.start();
  await until(() => concatFrames(server.frames).length === 160_000);

  assert.deepEqual(server.frames.map(frame => frame[0]), [6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
});

test('the gap buffer trims the oldest frame on an even boundary', async t => {
  const clock = createClock([500]);
  const { live, server } = await startSession(t, {}, { sampleRate: 8000 }, { clock });
  server.drop(1006);
  await until(() => clock.isHeld(500));
  live.send(frameOf(1, 100_000));
  live.send(frameOf(2, 100_000));
  clock.release(500);
  await until(() => concatFrames(server.frames).length === 160_000);

  assert.deepEqual(server.frames.map(frame => [frame[0], frame.length]), [[1, 60_000], [2, 100_000]]);
});

test('reconnecting retries with 0.5, 1, 2, 4 and 8 second backoff until it succeeds', async t => {
  const expected = [500, 1000, 2000, 4000, 8000, 8000, 8000];
  const clock = createClock([...new Set(expected)]);
  const started = await startSession(t, {}, {}, { clock });
  const { fake, server } = started;
  fake.knobs.liveTokenError = { status: 503, code: 'live_unavailable', message: 'down' };
  server.drop(1006);
  for (const [index, ms] of expected.entries()) {
    // eslint-disable-next-line no-await-in-loop
    await until(() => clock.isHeld(ms) && clock.delays.length === index + 1);
    if (index === expected.length - 1) {
      fake.knobs.liveTokenError = undefined;
    }

    clock.release(ms);
  }

  await until(() => payloadsOf(started, 'reconnected').length === 1);

  assert.deepEqual(clock.delays, expected);
  assert.deepEqual(payloadsOf(started, 'reconnecting').map(event => event.attempt), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(tokenRequests(fake.requests).length, 7);
});

test('a socket the server rejects (code 4001) is retried with a new token', async t => {
  const clock = createClock();
  const started = await startSession(t, {}, {}, { clock });
  const { fake, server } = started;
  fake.knobs.liveRejectConnects = 1;
  server.drop(1006);
  await until(() => payloadsOf(started, 'reconnected').length === 1);

  assert.deepEqual(clock.delays, [500, 1000]);
  assert.equal(tokenRequests(fake.requests).length, 2);
  assert.equal(server.connections, 2);
});

test('after 2 minutes the sdk gives up and end resolves disconnected from the session read', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { fake, live, server } = started;
  fake.knobs.liveTokenError = { status: 503, code: 'live_unavailable', message: 'down' };
  server.drop(1006);
  await until(() => payloadsOf(started, 'reconnecting').length > 0);
  const result = await live.end();

  assert.deepEqual(result, {
    reason: 'disconnected',
    transcriptionId: live.transcriptionId,
    minutesCharged: 1,
    connectedMs: 1500,
    audioMs: 1000,
  });
  assert.equal(clock.delays.reduce((sum, ms) => sum + ms, 0), 120_000);
  assert.deepEqual(clock.delays.slice(0, 5), [500, 1000, 2000, 4000, 8000]);
  assert.ok(clock.delays.every(ms => ms <= 8000));
  assert.deepEqual(payloadsOf(started, 'ended'), [result]);
  const reads = fake.requests.filter(request => request.method === 'GET' && request.path === `/v1/live/sessions/${live.id}`);
  assert.equal(reads.length, 1);
  assert.equal(server.commands.length, 0, 'end was never sent over a socket');
});

test('giving up falls back to the last usage when the session read fails', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { fake, live, server } = started;
  server.emit({
    type: 'usage', connected_ms: 5000, audio_ms: 4000, minutes_charged: 1, minutes_remaining: 9,
  });
  await until(() => payloadsOf(started, 'usage').length === 1);
  fake.knobs.liveTokenError = { status: 503, code: 'live_unavailable' };
  fake.knobs.liveGetError = { status: 500, code: 'internal_error' };
  server.drop(1006);
  await until(() => payloadsOf(started, 'reconnecting').length > 0);
  const result = await live.end();

  assert.deepEqual(result, {
    reason: 'disconnected',
    transcriptionId: live.transcriptionId,
    minutesCharged: 1,
    connectedMs: 5000,
    audioMs: 4000,
  });
});

test('a session the server has already ended stops the reconnecting at once', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { live, server } = started;
  server.ended = true;
  server.drop(1006);
  await until(() => payloadsOf(started, 'reconnecting').length > 0);
  const result = await live.end();

  assert.equal(result.reason, 'client_ended');
  assert.ok(clock.delays.length <= 1);
  assert.equal(server.connections, 1);
});

test('end() in the middle of a reconnect waits for it, replays the audio and then ends', async t => {
  const clock = createClock([500, END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { live, server } = started;
  server.drop(1006);
  await until(() => clock.isHeld(500));
  live.send(frameOf(1, 100));
  let settled = false;
  const pending = live.end().then(result => {
    settled = true;
    return result;
  });
  await settleFor(40);

  assert.equal(settled, false);
  assert.equal(clock.isHeld(END_TIMEOUT_MS), false, 'the end timeout starts only once the end command is sent');
  clock.release(500);
  const result = await pending;

  assert.equal(result.reason, 'client_ended');
  assert.equal(server.frames.length, 1);
  assert.deepEqual(server.commands, ['{"type":"end"}']);
  assert.equal(server.connections, 2);
});

test('a drop after the end command was sent resends it on the new connection', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, { liveAutoEnd: false }, {}, { clock });
  const { live, server } = started;
  const pending = live.end();
  await until(() => server.commands.length === 1);
  server.drop(1006);
  await until(() => server.connections === 2 && server.commands.length === 2);
  server.finish('client_ended');
  const result = await pending;

  assert.deepEqual(server.commands, ['{"type":"end"}', '{"type":"end"}']);
  assert.equal(result.reason, 'client_ended');
});

test('a terminal token answer (409 session_ended) stops reconnecting', async t => {
  const clock = createClock([END_TIMEOUT_MS]);
  const started = await startSession(t, {}, {}, { clock });
  const { fake, live, server } = started;
  fake.knobs.liveTokenError = { status: 409, code: 'session_ended', message: 'The live session has ended' };
  server.drop(1006);
  await until(() => payloadsOf(started, 'reconnecting').length > 0);
  const result = await live.end();

  assert.equal(result.reason, 'disconnected');
  assert.deepEqual(clock.delays, [500]);
});

test('getAccessToken is called for every request, including each resume token request', async t => {
  const fake = await startApi(t, { altKeys: ['tok-1', 'tok-2', 'tok-3', 'tok-4', 'tok-5'] });
  let calls = 0;
  const live = createLiveClient({
    baseUrl: fake.url,
    async getAccessToken() {
      calls++;
      return `tok-${String(calls)}`;
    },
  });
  const session = await live.start();
  const events: string[] = [];
  session.on('reconnected', () => {
    events.push('reconnected');
  });
  const server = fake.liveSessions.get(session.id);
  assert.ok(server);

  server.drop(1006);
  await until(() => events.length === 1);
  server.drop(1006);
  await until(() => events.length === 2);
  await session.end();

  const http = fake.requests.filter(request => request.path.startsWith('/v1/'));
  assert.equal(calls, http.length);
  assert.deepEqual(http.map(request => `${request.method} ${request.path.replace(/lv_\d+/, 'ID')}`), [
    'POST /v1/live/sessions',
    'POST /v1/live/sessions/ID/token',
    'POST /v1/live/sessions/ID/token',
  ]);
  assert.deepEqual(http.map(request => request.headers.authorization), ['Bearer tok-1', 'Bearer tok-2', 'Bearer tok-3']);
});

const resumeWithQueuedBoundary = async (t: TestContext, resumed: Record<string, unknown>) => {
  const { server, pending } = await startManual(t, { sampleRate: 8000 });
  server.start({ caption_boundaries: true });
  const live = await pending;
  // 8000 Hz: 1600 bytes is 100 ms
  live.send(frameOf(1, 1600));
  await until(() => server.frames.length === 1);
  // a drop, not a reconnect event: the fake closes a replaced socket with 4010 before this test sends started
  server.drop(1006);
  await until(() => server.connections === 2 && server.socket?.readyState === 1);
  const log: unknown[] = [];
  server.socket?.on('message', (data: Buffer, isBinary: boolean) => {
    log.push(isBinary ? data.byteLength : JSON.parse(data.toString('utf8')));
  });
  live.send(frameOf(2, 1600));
  assert.equal(live.boundary(150), true);
  live.send(frameOf(3, 1600));
  server.start({ offset_ms: 4200, ...resumed });
  await until(() => log.length >= 2);
  await settleFor(30);

  return { live, server, log };
};

test('rebases a queued boundary onto the wire clock after resume', async t => {
  const { live, log } = await resumeWithQueuedBoundary(t, { caption_boundaries: true });

  // input 150 ms lies 50 ms into the queued audio, which resumes at wire 4200
  assert.deepEqual(log, [1600, { type: 'caption.boundary', audio_ms: 4250 }, 1600]);
  await live.end();
});

test('drops queued boundaries after resume without support', async t => {
  const { live, server, log } = await resumeWithQueuedBoundary(t, {});

  assert.deepEqual(log, [1600, 1600]);
  assert.equal(live.boundary(400), false);
  await live.end();
  assert.ok(server.commands.every(command => !command.includes('caption.boundary')));
});

const resumeWithQueuedSwitch = async (t: TestContext, resumed: Record<string, unknown>) => {
  const { server, pending } = await startManual(t, { sampleRate: 8000 });
  server.start({ translation_switch: true });
  const live = await pending;
  live.send(frameOf(1, 1600));
  await until(() => server.frames.length === 1);
  server.drop(1006);
  await until(() => server.connections === 2 && server.socket?.readyState === 1);
  const log: unknown[] = [];
  server.socket?.on('message', (data: Buffer, isBinary: boolean) => {
    log.push(isBinary ? data.byteLength : JSON.parse(data.toString('utf8')));
  });
  live.send(frameOf(2, 1600));
  assert.equal(live.translate('de'), true);
  live.send(frameOf(3, 1600));
  server.start({ offset_ms: 4200, ...resumed });
  await until(() => log.length >= 2);
  await settleFor(30);

  return { live, server, log };
};

test('replays a queued translation switch in order after resume', async t => {
  const { live, log } = await resumeWithQueuedSwitch(t, { translation_switch: true });

  assert.deepEqual(log, [1600, { type: 'translation.set', translate_to: 'de' }, 1600]);
  await live.end();
});

test('drops a queued translation switch after resume without support', async t => {
  const { live, server, log } = await resumeWithQueuedSwitch(t, {});

  assert.deepEqual(log, [1600, 1600]);
  assert.equal(live.translate('fr'), false);
  await live.end();
  assert.ok(server.commands.every(command => !command.includes('translation.set')));
});
