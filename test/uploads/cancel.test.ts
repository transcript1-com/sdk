import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import type { Transcription } from '../../src/types.js';
import { cancelUpload } from '../../src/uploads/cancel.js';
import { countRequests, createUploadConfig, startApi } from './helpers.js';

const createUpload = async (config: Parameters<typeof request>[0]): Promise<Transcription> => {
  const body = { upload: { filename: 'a.mp3', size: 8, mime_type: 'audio/mpeg' } };
  const created = await request(config, {
    method: 'POST',
    path: '/v1/transcriptions',
    body,
    headers: { 'Idempotency-Key': 'k1' },
  });

  return created.json as Transcription;
};

test('deletes a job that still awaits its upload', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const job = await createUpload(config);

  assert.equal(await cancelUpload(config, job.id), 'deleted');
  assert.equal(countRequests(fake, 'DELETE', /^\/v1\/transcriptions\/tr_1$/), 1);
});

test('leaves a job that already started running', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const job = await createUpload(config);
  const put = { 'X-Upload-Token': job.upload!.headers['X-Upload-Token'] };
  await request(config, {
    method: 'PUT',
    path: `/v1/transcriptions/${job.id}/upload/chunks/0`,
    body: new Uint8Array(8),
    headers: put,
    auth: false,
  });
  await request(config, { method: 'POST', path: `/v1/transcriptions/${job.id}/upload/complete` });

  assert.equal(await cancelUpload(config, job.id), 'running');
  assert.equal(countRequests(fake, 'DELETE', /^\/v1\/transcriptions\/tr_1$/), 0);
});

test('gives up on a server that does not answer within five seconds', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const timeouts: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    timeouts.push(ms);
    return timeout(1);
  });
  config.fetch = (async (_input: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new Error('The request was aborted'));
    });
  })) as typeof fetch;

  await assert.rejects(cancelUpload(config, 'tr_1'), { code: 'aborted' });
  assert.deepEqual(timeouts, [5000]);
});
