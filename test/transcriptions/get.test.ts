import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from '../../src/transcriptions/create.js';
import { get } from '../../src/transcriptions/get.js';
import type { Transcription } from '../../src/types.js';
import {
  buildReply,
  buildJsonReply,
  createScriptedFetch,
  createTestConfig,
  expectRejection,
} from '../http/helpers.js';
import {
  LINK,
  createApiConfig,
  createRecorder,
  findPolls,
  getStatuses,
  startApi,
} from './helpers.js';

test('rejects a 200 answer without json with http_200', async () => {
  const stub = createScriptedFetch([buildReply(200, '<html>proxy</html>', { 'Content-Type': 'text/html' })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const error = await expectRejection(get(config, 'tr_1'));

  assert.equal(error.code, 'http_200');
  assert.equal(error.status, 200);
});

test('gets a transcription with one request and no wait', async t => {
  const fake = await startApi(t, { polls: 3 });
  const { config, sleeps } = createApiConfig(fake);
  const created = await create(config, LINK);
  const current = await get(config, created.id);
  const [request] = findPolls(fake);

  assert.equal(current.id, created.id);
  assert.equal(current.status, 'transcribing');
  assert.equal(findPolls(fake).length, 1);
  assert.equal(request?.query.get('wait'), null);
  assert.equal(request?.query.get('include'), null);
  assert.deepEqual(sleeps, []);
});

test('asks for words when includeWords is set', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const created = await create(config, LINK);
  await get(config, created.id, { includeWords: true });

  assert.equal(findPolls(fake)[0]?.query.get('include'), 'words');
});

test('returns the transcript of a completed job', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const created = await create(config, LINK);
  const done = await get(config, created.id);

  assert.equal(done.status, 'completed');
  assert.equal(done.transcript?.text, 'Welcome to the show. Thanks for having me.');
});

test('preserves completed X caption provenance and null word timings', async () => {
  const source: NonNullable<Transcription['transcript_source']> = 'x_captions';
  const reply = {
    id: 'tr_x', status: 'completed', transcript_source: source, caption_kind: 'auto_generated',
    transcript: {
      text: 'Example.', speakers: [], segments: [{
        start: 0, end: 1, text: 'Example.', speaker: null, language: 'en', words: null,
      }],
    },
  };
  const stub = createScriptedFetch([buildJsonReply(200, reply)]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  assert.deepEqual(await get(config, 'tr_x', { includeWords: true }), reply);
});

test('preserves opaque new-platform media IDs without hashing or truncation', async () => {
  const mediaId = 'e9637d63a71ec7c30f1dfb1288cee9d53e010f60d4594c204d16fb04ace52e1a';
  const reply = {
    id: 'tr_clip', object: 'transcription', status: 'completed',
    source: { platform: 'twitch', url: 'https://clips.twitch.tv/FaintLightGullWholeWheat', media_id: mediaId },
    transcript_source: 'speech_to_text', caption_kind: null,
  };
  const stub = createScriptedFetch([buildJsonReply(200, reply)]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await get(config, 'tr_clip');
  assert.ok(result.source.platform !== 'upload');
  assert.equal(result.source.media_id, mediaId);
  assert.equal(result.source.platform, 'twitch');
});

test('rejects an unknown id with not_found', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(get(config, 'tr_404'));

  assert.equal(error.code, 'not_found');
  assert.equal(error.status, 404);
});

test('rejects an empty id with invalid_input and sends nothing', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(get(config, ''));

  assert.equal(error.code, 'invalid_input');
  assert.equal(fake.requests.length, 0);
});

test('waits with wait=60 polls until the job ends and reports each new status', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 3 });
  const { config, sleeps } = createApiConfig(fake);
  const progress = createRecorder();
  const created = await create(config, LINK);
  const done = await get(config, created.id, { wait: true, onProgress: progress.onProgress });

  assert.equal(done.status, 'completed');
  assert.ok(done.transcript);
  assert.deepEqual(findPolls(fake).map(request => request.query.get('wait')), ['60', '60', '60']);
  assert.deepEqual(sleeps, [2000, 2000]);
  assert.deepEqual(getStatuses(progress.events), ['transcribing', 'completed']);
});
