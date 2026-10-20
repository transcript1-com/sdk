import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import { create } from '../../src/transcriptions/create.js';
import { expectRejection } from '../http/helpers.js';
import {
  CANONICAL,
  LINK,
  createApiConfig,
  createRecorder,
  filterByType,
  findCreates,
  parseBody,
  startApi,
} from './helpers.js';

test('creates a link without waiting, reusing a recent job, with the canonical url', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const created = await create(config, LINK, { idempotencyKey: 'key-1' });
  const [request] = findCreates(fake);

  assert.equal(created.status, 'queued');
  assert.equal(created.object, 'transcription');
  assert.equal(request?.query.get('wait'), '0');
  assert.equal(request?.query.get('reuse_recent'), 'true');
  assert.equal(request?.headers['idempotency-key'], 'key-1');
  assert.deepEqual(parseBody(request), { url: CANONICAL });
});

test('sends no platform for a YouTube link', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, LINK);
  const [request] = findCreates(fake);

  assert.ok(!('platform' in (parseBody(request) as Record<string, unknown>)));
});

test('sends an X link as the raw url with no platform', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const created = await create(config, 'https://x.com/jack/status/20');
  const [request] = findCreates(fake);
  const body = parseBody(request) as Record<string, unknown>;

  assert.ok(!('platform' in body));
  assert.deepEqual(body, { url: 'https://x.com/jack/status/20' });
  assert.equal(created.status, 'queued');
  assert.equal(created.source.platform, 'x');
});

test('sends source, language and diarize only when they are given', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, LINK, { source: 'stt', language: 'pl', speakers: true });
  await create(config, LINK, { speakers: false });
  const [first, second] = findCreates(fake);

  assert.deepEqual(parseBody(first), {
    url: CANONICAL,
    source: 'stt',
    language: 'pl',
    diarize: true,
  });
  assert.deepEqual(parseBody(second), { url: CANONICAL });
});

for (const [platform, url] of [
  ['twitch', 'https://clips.twitch.tv/SomeClip?t=30'],
  ['dailymotion', 'https://www.dailymotion.com/video/x123?t=30'],
  ['pinterest', 'https://www.pinterest.com/pin/123/'],
  ['linkedin', 'https://www.linkedin.com/feed/update/urn:li:activity:123/'],
  ['snapchat', 'https://www.snapchat.com/spotlight/Ab_C'],
] as const) {
  test(`creates ${platform} through the SDK without trimming or overriding source options`, async t => {
    const fake = await startApi(t);
    const { config } = createApiConfig(fake);
    const created = await create(config, url, { source: 'stt', speakers: true, language: 'pl' });
    assert.deepEqual(parseBody(findCreates(fake)[0]), {
      url, source: 'stt', diarize: true, language: 'pl',
    });
    assert.equal(created.source.platform, platform);
    assert.equal(created.source.url, url);
  });
}

test('drops reuse_recent when fresh is set', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const first = await create(config, LINK);
  const second = await create(config, LINK, { fresh: true });

  assert.equal(findCreates(fake)[1]?.query.get('reuse_recent'), null);
  assert.equal(findCreates(fake)[1]?.query.get('wait'), '0');
  assert.notEqual(second.id, first.id);
});

test('reuses a recent job of the same link without fresh', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const first = await create(config, LINK);
  const second = await create(config, LINK);

  assert.equal(second.id, first.id);
  assert.equal(second.reused, true);
});

test('generates a different idempotency key for each create without one', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, LINK, { fresh: true });
  await create(config, LINK, { fresh: true });
  const keys = findCreates(fake).map(request => request.headers['idempotency-key']);

  assert.match(String(keys[0]), /^[\da-f-]{36}$/);
  assert.notEqual(keys[0], keys[1]);
});

test('uploads a file with the same key and the upload body', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const bytes = new Uint8Array(20).fill(7);
  const created = await create(config, bytes, {
    filename: 'Interview Ünal.m4a',
    language: 'de',
    speakers: true,
    idempotencyKey: 'up-1',
  });
  const [request] = findCreates(fake);

  assert.equal(created.status, 'queued');
  assert.deepEqual(fake.uploaded(created.id), bytes);
  assert.equal(request?.headers['idempotency-key'], 'up-1');
  assert.equal(request?.query.get('reuse_recent'), null);
  assert.deepEqual(parseBody(request), {
    upload: { filename: 'Interview Ünal.m4a', size: 20, mime_type: 'audio/mp4' },
    language: 'de',
    diarize: true,
  });
});

test('waits for a job slot on 429 and retries with the same key', async t => {
  const fake = await startApi(t, { activeLimit: 1 });
  const sleeps: number[] = [];
  const { config } = createApiConfig(fake, {
    async sleep(ms) {
      sleeps.push(ms);
      fake.knobs.activeLimit = 1;
      if (sleeps.length >= 2) {
        fake.knobs.activeLimit = 0;
      }
    },
  });
  const progress = createRecorder();
  await create(config, LINK, { fresh: true });
  const created = await create(config, LINK, { fresh: true, idempotencyKey: 'slot-1', onProgress: progress.onProgress });
  const keys = findCreates(fake).slice(1).map(request => request.headers['idempotency-key']);

  assert.equal(created.status, 'queued');
  assert.deepEqual(sleeps, [1000, 1000]);
  assert.deepEqual(keys, ['slot-1', 'slot-1', 'slot-1']);
  assert.deepEqual(filterByType(progress.events, 'waiting_slot'), [
    { type: 'waiting_slot', retryAfter: 1 },
    { type: 'waiting_slot', retryAfter: 1 },
  ]);
});

test('waits for a job slot when too many uploads are open and then uploads the file', async t => {
  const fake = await startApi(t, { openUploadLimit: 1 });
  const sleeps: number[] = [];
  const { config } = createApiConfig(fake, {
    async sleep(ms) {
      sleeps.push(ms);
      fake.knobs.openUploadLimit = 0;
    },
  });
  const progress = createRecorder();
  await request(config, {
    method: 'POST',
    path: '/v1/transcriptions',
    body: { upload: { filename: 'old.mp3', size: 8, mime_type: 'audio/mpeg' } },
    headers: { 'Idempotency-Key': 'stale' },
  });
  const created = await create(config, new Uint8Array(20), {
    filename: 'talk.mp3',
    idempotencyKey: 'up-2',
    onProgress: progress.onProgress,
  });
  const keys = findCreates(fake).slice(1).map(call => call.headers['idempotency-key']);

  assert.equal(created.status, 'queued');
  assert.deepEqual(sleeps, [1000]);
  assert.deepEqual(filterByType(progress.events, 'waiting_slot'), [{ type: 'waiting_slot', retryAfter: 1 }]);
  assert.deepEqual(keys, ['up-2', 'up-2']);
});

test('ends a job-slot wait with aborted when the signal fires', async t => {
  const fake = await startApi(t, { activeLimit: 1 });
  const controller = new AbortController();
  const { config } = createApiConfig(fake);
  await create(config, LINK, { fresh: true });
  const error = await expectRejection(create(config, LINK, {
    fresh: true,
    signal: controller.signal,
    onProgress() {
      controller.abort();
    },
  }));

  assert.equal(error.code, 'aborted');
  assert.equal(findCreates(fake).length, 2);
});

test('rejects a link it cannot read with invalid_input and sends nothing', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(create(config, 'https://vimeo.com/123'));

  assert.equal(error.code, 'invalid_input');
  assert.equal(fake.requests.length, 0);
});
