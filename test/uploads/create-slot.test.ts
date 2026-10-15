import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ConfigType } from '../../src/config.js';
import { request } from '../../src/http/request.js';
import type { Transcription } from '../../src/types.js';
import { uploadFile } from '../../src/uploads/upload-file.js';
import { expectRejection } from '../http/helpers.js';
import {
  buildBytes,
  buildFile,
  buildOptions,
  countRequests,
  createUploadConfig,
  findRequests,
  startApi,
} from './helpers.js';

const CREATE = /^\/v1\/transcriptions$/;

const createStaleUpload = async (config: ConfigType) => request(config, {
  method: 'POST',
  path: '/v1/transcriptions',
  body: {
    upload: {
      filename: 'old.mp3',
      size: 8,
      mime_type: 'audio/mpeg',
    },
  },
  headers: { 'Idempotency-Key': 'stale' },
});

test('waits for a job slot when the upload create answers 429 and retries it with the same key', async t => {
  const fake = await startApi(t, { openUploadLimit: 1 });
  const { config } = createUploadConfig(fake);
  const stale = await createStaleUpload(config);
  const staleId = (stale.json as Transcription).id;
  const bytes = buildBytes(30);
  const file = buildFile(bytes);
  const waits: string[] = [];
  const options = buildOptions(file, {
    async waitSlot(error) {
      waits.push(error.code);
      if (waits.length === 2) {
        await request(config, { method: 'DELETE', path: `/v1/transcriptions/${staleId}` });
      }
    },
  });
  const done = await uploadFile(config, file, options);
  const keys = findRequests(fake, 'POST', CREATE).slice(1).map(call => call.headers['idempotency-key']);

  assert.equal(done.status, 'queued');
  assert.deepEqual(waits, ['too_many_active_jobs', 'too_many_active_jobs']);
  assert.deepEqual(keys, ['key-1', 'key-1', 'key-1']);
  assert.deepEqual(fake.uploaded(done.id), bytes);
});

test('ends a job-slot wait on the upload create with aborted and leaves no job', async t => {
  const fake = await startApi(t, { openUploadLimit: 1 });
  const { config } = createUploadConfig(fake);
  await createStaleUpload(config);
  const controller = new AbortController();
  const file = buildFile(buildBytes(30));
  const options = buildOptions(file, {
    signal: controller.signal,
    async waitSlot() {
      controller.abort();
    },
  });
  const error = await expectRejection(uploadFile(config, file, options));
  const listed = await request(config, { method: 'GET', path: '/v1/transcriptions' });

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, undefined);
  assert.equal(countRequests(fake, 'POST', CREATE), 2);
  assert.equal(countRequests(fake, 'DELETE', /./), 0);
  assert.equal((listed.json as { data: unknown[] }).data.length, 1);
});
