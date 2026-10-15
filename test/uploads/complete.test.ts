import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Transcript1Error } from '../../src/errors.js';
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
  getPuts,
  getUploadEvents,
  startApi,
} from './helpers.js';

const COMPLETE = /\/upload\/complete$/;

test('resends the missing chunks once and completes again', async t => {
  const fake = await startApi(t, { completeMissing: [1, 2] });
  const { config } = createUploadConfig(fake);
  const bytes = buildBytes(30);
  const file = buildFile(bytes);
  const options = buildOptions(file);
  const done = await uploadFile(config, file, options);

  assert.equal(done.status, 'queued');
  assert.deepEqual(getPuts(fake).sort((a, b) => a - b), [0, 1, 1, 2, 2, 3]);
  assert.equal(countRequests(fake, 'POST', COMPLETE), 2);
  assert.deepEqual(fake.uploaded(done.id), bytes);
  assert.deepEqual(getUploadEvents(options.events).at(-1), [30, 30]);
  assert.equal(getUploadEvents(options.events).length, 4);
});

test('fails a stream with upload_incomplete because it cannot resend', async t => {
  const fake = await startApi(t, { completeMissing: [1] });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(30), 'stream');
  const error = await expectRejection(uploadFile(config, file, buildOptions(file)));

  assert.equal(error.code, 'upload_incomplete');
  assert.equal(error.status, 409);
  assert.equal(error.transcriptionId, 'tr_1');
  assert.deepEqual(error.details.missing_chunks, [1]);
  assert.equal(getPuts(fake).length, 4);
  assert.equal(countRequests(fake, 'POST', COMPLETE), 1);
});

test('waits for a job slot on complete and retries only the complete', async t => {
  const fake = await startApi(t, { activeLimit: 1 });
  const { config } = createUploadConfig(fake);
  const link = await request(config, { method: 'POST', path: '/v1/transcriptions', body: { platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' } });
  const busy = (link.json as Transcription).id;
  const file = buildFile(buildBytes(30));
  const waits: Transcript1Error[] = [];
  const options = buildOptions(file, {
    async waitSlot(error) {
      waits.push(error);
      await request(config, { method: 'DELETE', path: `/v1/transcriptions/${busy}` });
    },
  });
  const done = await uploadFile(config, file, options);

  assert.equal(done.status, 'queued');
  assert.deepEqual(waits.map(error => [error.code, error.status]), [['too_many_active_jobs', 429]]);
  assert.equal(countRequests(fake, 'POST', COMPLETE), 2);
  assert.deepEqual(getPuts(fake).sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('passes the signal to waitSlot and fails with its error', async t => {
  const fake = await startApi(t, { activeLimit: 1 });
  const { config } = createUploadConfig(fake);
  await request(config, { method: 'POST', path: '/v1/transcriptions', body: { platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' } });
  const file = buildFile(buildBytes(8));
  const controller = new AbortController();
  let seen: AbortSignal | undefined;
  const options = buildOptions(file, {
    signal: controller.signal,
    async waitSlot(error, signal) {
      seen = signal;
      throw error;
    },
  });
  const error = await expectRejection(uploadFile(config, file, options));

  assert.ok(seen);
  assert.equal(error.code, 'too_many_active_jobs');
  assert.equal(error.transcriptionId, 'tr_2');
});
