import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transcribe } from '../src/transcribe.js';
import { expectRejection } from './http/helpers.js';
import { makeTempDir, writeTempFile } from './inputs/helpers.js';
import {
  LINK,
  createApiConfig,
  createRecorder,
  findCreates,
  findPolls,
  getStatuses,
  hookBeforePoll,
  startApi,
} from './transcriptions/helpers.js';

test('transcribes a link and resolves with the completed transcript', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const done = await transcribe(config, LINK);

  assert.equal(done.status, 'completed');
  assert.equal(done.transcript?.text, 'Welcome to the show. Thanks for having me.');
  assert.equal(findPolls(fake).length, 1);
});

test('transcribes a file by path', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const directory = await makeTempDir();
  const file = await writeTempFile(directory, 'Interview Ünal.mp3', 'some audio bytes');
  const done = await transcribe(config, file, { speakers: true });

  assert.equal(done.status, 'completed');
  assert.equal(done.source.platform, 'upload');
  assert.deepEqual(done.transcript?.speakers, ['Speaker 1', 'Speaker 2']);
});

test('transcribes bytes with a filename', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const done = await transcribe(config, Buffer.from('call recording'), { filename: 'call.mp3' });

  assert.equal(done.status, 'completed');
  assert.equal(fake.uploaded(done.id).byteLength, 14);
});

test('reports upload, status and completed progress in order', async t => {
  const fake = await startApi(t, { polls: 2 });
  const { config } = createApiConfig(fake);
  const progress = createRecorder();
  await transcribe(config, Buffer.from('call recording'), { filename: 'call.mp3', onProgress: progress.onProgress });

  assert.deepEqual(progress.events.slice(0, 2).map(event => event.type), ['status', 'upload']);
  assert.deepEqual(getStatuses(progress.events), ['awaiting_upload', 'queued', 'transcribing', 'completed']);
});

test('fetches the transcript of a reused job that came back without one', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await transcribe(config, LINK);
  const again = await transcribe(config, LINK);

  assert.equal(again.status, 'completed');
  assert.ok(again.transcript);
  assert.equal(findCreates(fake).length, 2);
  assert.equal(findPolls(fake).length, 2);
});

test('rejects with the job error code and the failed transcription', async t => {
  const fake = await startApi(t, { failCode: 'no_speech' });
  const { config } = createApiConfig(fake);
  const error = await expectRejection(transcribe(config, LINK));

  assert.equal(error.code, 'no_speech');
  assert.equal(error.message, 'The job failed with no_speech');
  assert.ok(error.transcriptionId);
  assert.equal(error.transcription?.status, 'failed');
  assert.equal(error.transcription?.id, error.transcriptionId);
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
  const error = await expectRejection(transcribe(config, LINK));

  assert.equal(error.code, 'canceled');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(error.transcription?.status, 'canceled');
});

test('aborts before any request with no job id', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(transcribe(config, LINK, { signal: AbortSignal.abort() }));

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, undefined);
  assert.equal(fake.requests.length, 0);
});

test('aborts while waiting and keeps the job running', async t => {
  const fake = await startApi(t, { polls: 3 });
  const controller = new AbortController();
  const { config } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      2() {
        controller.abort();
      },
    }),
  });
  const error = await expectRejection(transcribe(config, LINK, { signal: controller.signal }));

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(fake.requests.filter(request => request.method === 'DELETE').length, 0);
});

test('lets 20 concurrent transcriptions share two job slots', async t => {
  const fake = await startApi(t, { activeLimit: 2 });
  const { config } = createApiConfig(fake);
  const calls = Array.from({ length: 20 }, async (_, index) => {
    if (index % 2 === 0) {
      return transcribe(config, LINK, { fresh: true });
    }

    return transcribe(config, Buffer.from(`recording number ${index}`), { filename: `call-${index}.mp3` });
  });
  const done = await Promise.all(calls);

  assert.equal(done.length, 20);
  assert.ok(done.every(job => job.status === 'completed'));
  assert.ok(done.every(job => Boolean(job.transcript)));
  assert.equal(new Set(done.map(job => job.id)).size, 20);
  assert.ok(fake.peakActive() <= 2, `peak active was ${fake.peakActive()}`);
});
