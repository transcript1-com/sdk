import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadFile } from '../../src/uploads/upload-file.js';
import { createTestConfig, expectRejection } from '../http/helpers.js';
import {
  buildBytes,
  buildFile,
  buildOptions,
  countRequests,
  createGate,
  createUploadConfig,
  findRequests,
  getPuts,
  getUploadEvents,
  startApi,
  tick,
  type ChunkReplyType,
} from './helpers.js';

const CREATE = /^\/v1\/transcriptions$/;
const PROGRESS = /\/upload$/;

const assertSentOnceAfterSuccess = (replies: ChunkReplyType[], chunks: number) => {
  for (let index = 0; index < chunks; index++) {
    const statuses = replies.filter(reply => reply.index === index).map(reply => reply.status);
    assert.equal(statuses.filter(status => status === 200).length, 1, `chunk ${index}: ${statuses.join(',')}`);
    assert.equal(statuses.at(-1), 200);
  }
};

test('renews a refused token once with the same key, reads progress once and sends only missing chunks', async t => {
  const fake = await startApi(t, { chunkStatus: { 1: [401] } });
  const { config, replies } = createUploadConfig(fake);
  const bytes = buildBytes(30);
  const file = buildFile(bytes);
  const done = await uploadFile(config, file, buildOptions(file));
  const creates = findRequests(fake, 'POST', CREATE);

  assert.equal(creates.length, 2);
  assert.deepEqual(creates.map(request => request.headers['idempotency-key']), ['key-1', 'key-1']);
  assert.equal(countRequests(fake, 'GET', PROGRESS), 1);
  assert.deepEqual(replies.filter(reply => reply.index === 1).map(reply => reply.status), [401, 200]);
  assertSentOnceAfterSuccess(replies, 4);
  assert.deepEqual(fake.uploaded(done.id), bytes);
});

test('does not resend a chunk the progress read shows as received', async t => {
  const fake = await startApi(t);
  let lost = false;
  const losing = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await fetch(input, init);
    if (lost) {
      return response;
    }

    if (!String(input).endsWith('/chunks/2')) {
      return response;
    }

    lost = true;
    await response.text();
    const error = {
      code: 'unauthorized',
      message: 'Expired',
      retryable: false,
    };
    const body = JSON.stringify({ error });

    return new Response(body, { status: 401, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const { config } = createTestConfig({ fetch: losing, baseUrl: fake.url });
  const bytes = buildBytes(30);
  const file = buildFile(bytes);
  const options = buildOptions(file);
  const done = await uploadFile(config, file, options);

  assert.equal(getPuts(fake).filter(index => index === 2).length, 1);
  assert.equal(countRequests(fake, 'GET', PROGRESS), 1);
  assert.deepEqual(fake.uploaded(done.id), bytes);
  assert.deepEqual(getUploadEvents(options.events).at(-1), [30, 30]);
});

test('renews once when every chunk in flight is refused together', async t => {
  const { promise, open } = createGate();
  const fake = await startApi(t, {
    blockChunks: promise,
    chunkStatus: {
      0: [401],
      1: [401],
      2: [401],
      3: [401],
    },
  });
  const { config, replies } = createUploadConfig(fake);
  const file = buildFile(buildBytes(32));
  const upload = uploadFile(config, file, buildOptions(file));
  while (getPuts(fake).length < 4) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }

  open();
  await upload;
  assert.equal(countRequests(fake, 'POST', CREATE), 2);
  assert.equal(countRequests(fake, 'GET', PROGRESS), 1);
  assertSentOnceAfterSuccess(replies, 4);
});

test('gives up with upload_token_refused after renewing a chunk token twice', async t => {
  const fake = await startApi(t, { chunkStatus: { 0: [401, 401, 401] } });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(8));
  const error = await expectRejection(uploadFile(config, file, buildOptions(file)));

  assert.equal(error.code, 'upload_token_refused');
  assert.equal(error.status, 401);
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(countRequests(fake, 'POST', CREATE), 3);
  assert.equal(countRequests(fake, 'POST', /\/upload\/complete$/), 0);
});

test('keeps unauthorized when the renewing create itself is refused', async t => {
  const fake = await startApi(t, { chunkStatus: { 0: [401] } });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(8));
  const options = buildOptions(file, {
    onProgress() {
      fake.knobs.key = 'revoked';
    },
  });
  const error = await expectRejection(uploadFile(config, file, options));

  assert.equal(error.code, 'unauthorized');
  assert.equal(error.status, 401);
  assert.equal(error.transcriptionId, 'tr_1');
});

test('resends the held chunk of a stream after renewing its token', async t => {
  const fake = await startApi(t, { chunkStatus: { 2: [401] } });
  const { config, replies } = createUploadConfig(fake);
  const bytes = buildBytes(30);
  const file = buildFile(bytes, 'stream');
  const done = await uploadFile(config, file, buildOptions(file));

  assert.deepEqual(replies.filter(reply => reply.index === 2).map(reply => reply.status), [401, 200]);
  assertSentOnceAfterSuccess(replies, 4);
  assert.deepEqual(fake.uploaded(done.id), bytes);
});
