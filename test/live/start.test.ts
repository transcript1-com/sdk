import assert from 'node:assert/strict';
import { test } from 'node:test';
import WebSocketImpl from 'ws';
import { Transcript1 } from '../../src/client.js';
import { Transcript1Error } from '../../src/errors.js';
import type { RecordedRequestType } from '../fake-api/server.js';
import { buildJsonReply, createScriptedFetch, expectRejection } from '../http/helpers.js';
import {
  createClient,
  startApi,
  startManual,
  startSession,
  until,
} from './helpers.js';

const parse = (body: Buffer | undefined): unknown => JSON.parse(body?.toString() ?? '{}');

const findCreates = (requests: RecordedRequestType[]) => requests.filter(request => request.method === 'POST' && request.path === '/v1/live/sessions');

test('start posts snake_case options and opens the socket with the t1-live subprotocol and token', async t => {
  const { fake, live, server } = await startSession(t, {}, {
    language: 'en',
    translateTo: 'es',
    diarize: true,
    sampleRate: 8000,
    save: false,
  });
  const [create] = findCreates(fake.requests);

  assert.deepEqual(parse(create?.body), {
    language: 'en',
    translate_to: 'es',
    diarize: true,
    sample_rate: 8000,
    save: false,
  });
  assert.equal(create?.headers.authorization, 'Bearer t1_test');
  assert.equal(server.protocols[0], 't1-live');
  assert.equal(server.protocols[1], server.token);
  assert.equal(server.tokenUsed, true);
  assert.equal(live.id, server.id);
  assert.equal(live.transcriptionId, null);
  assert.deepEqual(live.lines, []);
});

test('start with no options posts an empty body and exposes the transcription id', async t => {
  const { fake, live } = await startSession(t);

  assert.deepEqual(parse(findCreates(fake.requests)[0]?.body), {});
  assert.match(live.transcriptionId ?? '', /^tr_live_/);
});

test('start throws live_capacity as a retryable error and does not retry the create', async t => {
  const fake = await startApi(t, {
    liveError: {
      status: 503, code: 'live_capacity', message: 'Live transcription is at capacity', retryAfter: 30,
    },
  });
  const error = await expectRejection(createClient(fake).live.start());

  assert.equal(error.code, 'live_capacity');
  assert.equal(error.status, 503);
  assert.equal(error.retryable, true);
  assert.equal(error.details.retry_after, 30);
  assert.equal(findCreates(fake.requests).length, 1);
});

test('start throws insufficient_minutes', async t => {
  const fake = await startApi(t, { minutesLeft: 0 });
  const error = await expectRejection(createClient(fake).live.start());

  assert.equal(error.code, 'insufficient_minutes');
  assert.equal(error.status, 402);
  assert.equal(error.retryable, false);
  assert.equal(error.details.minutes_needed, 1);
});

for (const [status, code, retryable] of [
  [429, 'too_many_live_sessions', true],
  [422, 'unsupported_translation', false],
  [503, 'live_unavailable', false],
  [403, 'email_not_verified', false],
] as const) {
  test(`start throws ${code} once`, async t => {
    const fake = await startApi(t, {
      liveError: {
        status, code, retryable, retryAfter: status === 429 ? 30 : undefined,
      },
    });
    const error = await expectRejection(createClient(fake).live.start());

    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.equal(error.retryable, retryable);
    assert.equal(findCreates(fake.requests).length, 1);
  });
}

test('start throws websocket_unavailable before creating a session when there is no WebSocket', async t => {
  const fake = await startApi(t);
  const original = globalThis.WebSocket;

  (globalThis as any).WebSocket = undefined;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const error = await expectRejection(createClient(fake).live.start());

  assert.equal(error.code, 'websocket_unavailable');
  assert.match(error.message, /WebSocket/);
  assert.equal(findCreates(fake.requests).length, 0);
});

test('start uses an injected WebSocket', async t => {
  const fake = await startApi(t);
  const urls: string[] = [];
  class Spy extends WebSocketImpl {
    constructor(url: string, protocols: string[]) {
      super(url, protocols);
      urls.push(url);
    }
  }

  const original = globalThis.WebSocket;

  (globalThis as any).WebSocket = undefined;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const t1 = createClient(fake, { WebSocket: Spy as unknown as typeof WebSocket });
  const live = await t1.live.start();
  const server = fake.liveSessions.get(live.id);

  assert.equal(urls.length, 1);
  assert.match(urls[0] ?? '', /\/v1\/live\/sessions\/lv_1\/stream$/);
  assert.equal(server?.tokenUsed, true);
  const result = await live.end();
  assert.equal(result.reason, 'client_ended');
});

test('start fails with network_error when the socket cannot open', async () => {
  const stub = createScriptedFetch([buildJsonReply(201, {
    id: 'lv_x',
    status: 'waiting',
    transcription_id: 'tr_x',
    websocket_url: 'ws://127.0.0.1:1/v1/live/sessions/lv_x/stream',
    token: 'tok',
    token_expires_at: '2026-11-01T12:00:00.000Z',
    rate: 1,
  })]);
  const t1 = new Transcript1({ apiKey: 't1_test', baseUrl: 'http://api.test', fetch: stub.fetch });
  const error = await expectRejection(t1.live.start());

  assert.equal(error.code, 'network_error');
  assert.equal(error.retryable, true);
});

test('start rejects with aborted when the signal is already aborted', async t => {
  const fake = await startApi(t);
  const controller = new AbortController();
  controller.abort();
  const error = await expectRejection(createClient(fake).live.start({ signal: controller.signal }));

  assert.equal(error.code, 'aborted');
  assert.equal(findCreates(fake.requests).length, 0);
});

test('get maps the session to camelCase', async t => {
  const { fake, live } = await startSession(t, {}, { translateTo: 'es', sampleRate: 8000 });
  const info = await createClient(fake).live.get(live.id);

  assert.equal(info.id, live.id);
  assert.equal(info.status, 'connected');
  assert.equal(info.endReason, null);
  assert.equal(info.transcriptionId, live.transcriptionId);
  assert.deepEqual(info.options, {
    language: 'auto',
    translateTo: 'es',
    diarize: false,
    audioFormat: 'pcm_s16le',
    sampleRate: 8000,
    save: true,
  });
  assert.equal(info.connectedMs, 1500);
  assert.equal(info.audioMs, 1000);
  assert.equal(info.minutesCharged, 1);
  assert.equal(info.rate, 1);
  assert.equal(typeof info.createdAt, 'string');
  assert.equal(info.endedAt, null);
});

test('get throws not_found for an unknown session', async t => {
  const fake = await startApi(t);
  const error = await expectRejection(createClient(fake).live.get('lv_nope'));

  assert.equal(error.code, 'not_found');
  assert.ok(error instanceof Transcript1Error);
});

test('capabilities maps the provider description to camelCase', async t => {
  const fake = await startApi(t);
  const capabilities = await createClient(fake).live.capabilities();

  assert.deepEqual(capabilities, {
    available: true,
    autoLanguage: true,
    languages: ['en', 'es', 'de'],
    translation: { targets: ['es', 'de'], pairs: 'any', requiresLanguage: false },
    diarize: true,
    audioFormats: ['pcm_s16le'],
    sampleRate: { min: 8000, max: 48_000 },
    maxSessionMinutes: 300,
    rate: 1,
  });
});

test('capabilities reports an unavailable provider', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, { available: false, rate: 1 })]);
  const t1 = new Transcript1({ apiKey: 't1_test', baseUrl: 'http://api.test', fetch: stub.fetch });

  assert.deepEqual(await t1.live.capabilities(), { available: false, rate: 1 });
});

const settleFor = async (ms: number) => new Promise(resolve => {
  setTimeout(resolve, ms);
});

test('start resolves only after session.started, and the caller still sees started and an early line', async t => {
  const manual = await startManual(t);
  let resolved = false;
  manual.pending.then(() => {
    resolved = true;
  });
  await settleFor(50);

  assert.equal(resolved, false);
  manual.server.start({ transcription_id: 'tr_from_started' });
  manual.server.emit({
    type: 'line',
    line: {
      id: 0, start_ms: 0, end_ms: 500, speaker: null, language: 'en', text: 'early', final: false, translation: null,
    },
  });
  const live = await manual.pending;

  assert.equal(live.transcriptionId, 'tr_from_started');
  const seen: string[] = [];
  live.on('started', event => {
    seen.push(`started:${event.transcriptionId ?? 'none'}`);
  });
  live.on('line', line => {
    seen.push(`line:${line.text}`);
  });
  await until(() => seen.length === 2);

  assert.deepEqual(seen, ['started:tr_from_started', 'line:early']);
  assert.equal(live.lines.length, 1);
});

test('started carries sameLanguage when the session language is the target language', async t => {
  const manual = await startManual(t, { language: 'en', translateTo: 'en' });
  manual.server.start({ same_language: true });
  const live = await manual.pending;
  const seen: Array<boolean | undefined> = [];
  live.on('started', event => {
    seen.push(event.sameLanguage);
  });
  await until(() => seen.length === 1);

  assert.deepEqual(seen, [true]);
});

test('start fails with network_error when the socket closes before session.started', async t => {
  const manual = await startManual(t);
  manual.server.drop(1011);
  const error = await expectRejection(manual.pending);

  assert.equal(error.code, 'network_error');
  assert.equal(error.retryable, true);
  assert.match(error.message, /1011/);
});

test('aborting while waiting for session.started rejects with aborted and closes the socket', async t => {
  const fake = await startApi(t, { liveManualStart: true });
  const controller = new AbortController();
  const pending = createClient(fake).live.start({ signal: controller.signal });
  await until(() => fake.liveSessions.get('lv_1')?.socket !== undefined);
  controller.abort();
  const error = await expectRejection(pending);

  assert.equal(error.code, 'aborted');
  await until(() => fake.liveSessions.get('lv_1')?.closeCode !== undefined);
});
