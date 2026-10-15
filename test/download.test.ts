import assert from 'node:assert/strict';
import { test } from 'node:test';
import { download } from '../src/download.js';
import { create } from '../src/transcriptions/create.js';
import type { Transcription } from '../src/types.js';
import { expectRejection } from './http/helpers.js';
import {
  LINK,
  createApiConfig,
  findPolls,
  hookBeforePoll,
  startApi,
} from './transcriptions/helpers.js';

const WELCOME = 'Welcome to the show.';

test('waits for the job, then returns the text rendering', async t => {
  const fake = await startApi(t, { polls: 2 });
  const { config } = createApiConfig(fake, { sleep: async () => undefined });
  const job = await create(config, LINK);
  const text = await download(config, job.id);
  const last = fake.requests.at(-1);

  assert.equal(text, 'Welcome to the show.\nThanks for having me.\n');
  assert.equal(last?.query.get('format'), 'text');
  assert.equal(last?.query.has('timestamps'), false);
  assert.equal(findPolls(fake).length, 3);
});

test('adds timestamps to the text only when asked', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK);
  const text = await download(config, job.id, { timestamps: true });

  assert.equal(text, '[00:00:00] Welcome to the show.\n[00:00:03] Thanks for having me.\n');
  assert.equal(fake.requests.at(-1)?.query.get('timestamps'), 'true');
});

test('returns srt and vtt as the API renders them', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK, { speakers: true });
  const srt = await download(config, job.id, { format: 'srt' });
  const vtt = await download(config, job.id, { format: 'vtt' });

  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,200\nSpeaker 1: Welcome to the show\.\n/);
  assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:03\.200\n<v Speaker 1>Welcome to the show\./);
});

test('returns the JSON text of the completed transcription', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK);
  const json = await download(config, job.id, { format: 'json' });
  const parsed = JSON.parse(json) as Transcription;

  assert.equal(parsed.id, job.id);
  assert.equal(parsed.status, 'completed');
  assert.ok(parsed.transcript?.text.startsWith(WELCOME));
  assert.equal(fake.requests.at(-1)?.query.has('format'), false);
});

test('refuses timestamps for a format other than text before any request', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(download(config, 'tr_1', { format: 'srt', timestamps: true }));

  assert.equal(error.code, 'invalid_input');
  assert.equal(fake.requests.length, 0);
});

test('refuses an unknown format before any request', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(download(config, 'tr_1', { format: 'pdf' as 'srt' }));

  assert.equal(error.code, 'invalid_input');
  assert.equal(fake.requests.length, 0);
});

test('rejects with the job error code when the job failed', async t => {
  const fake = await startApi(t, { failCode: 'no_captions' });
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK);
  const error = await expectRejection(download(config, job.id, { format: 'srt' }));

  assert.equal(error.code, 'no_captions');
  assert.equal(error.transcriptionId, job.id);
  assert.equal(error.transcription?.status, 'failed');
});

test('rejects with canceled when the job was canceled', async t => {
  const fake = await startApi(t, { polls: 2 });
  const { config } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      async 1() {
        await fetch(`${fake.url}/v1/transcriptions/tr_1`, { method: 'DELETE', headers: { Authorization: 'Bearer t1_test' } });
      },
    }),
  });
  const job = await create(config, LINK);
  const error = await expectRejection(download(config, job.id));

  assert.equal(error.code, 'canceled');
  assert.equal(error.transcriptionId, job.id);
});

test('aborts while waiting with the job id', async t => {
  const fake = await startApi(t, { polls: 3 });
  const controller = new AbortController();
  const { config } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      2() {
        controller.abort();
      },
    }),
  });
  const job = await create(config, LINK);
  const error = await expectRejection(download(config, job.id, { signal: controller.signal }));

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, job.id);
});
