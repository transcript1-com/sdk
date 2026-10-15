import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadFile } from '../../src/uploads/upload-file.js';
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
} from './helpers.js';

test('sends every chunk once, completes once and returns the queued transcription', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const bytes = buildBytes(30);
  const file = buildFile(bytes);
  const options = buildOptions(file);
  const done = await uploadFile(config, file, options);

  assert.equal(done.status, 'queued');
  assert.deepEqual(getPuts(fake).sort((a, b) => a - b), [0, 1, 2, 3]);
  assert.equal(countRequests(fake, 'POST', /\/upload\/complete$/), 1);
  assert.equal(countRequests(fake, 'POST', /^\/v1\/transcriptions$/), 1);
  assert.deepEqual(fake.uploaded(done.id), bytes);
});

test('creates with the idempotency key and the upload body, without reuse_recent', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(10));
  const options = buildOptions(file, { idempotencyKey: 'abc-123' });
  await uploadFile(config, file, options);
  const [create] = findRequests(fake, 'POST', /^\/v1\/transcriptions$/);

  assert.equal(create?.headers['idempotency-key'], 'abc-123');
  assert.equal(create?.query.get('reuse_recent'), null);
  assert.deepEqual(JSON.parse(create?.body?.toString() ?? '{}'), {
    upload: { filename: 'talk.mp3', size: 10, mime_type: 'audio/mpeg' },
    language: 'auto',
    diarize: false,
  });
});

test('reports upload progress after each chunk, rising and ending at the size', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(30));
  const options = buildOptions(file);
  await uploadFile(config, file, options);
  const progress = getUploadEvents(options.events);

  assert.equal(progress.length, 4);
  assert.deepEqual(progress.at(-1), [30, 30]);
  for (let index = 1; index < progress.length; index++) {
    assert.ok(progress[index]![0] > progress[index - 1]![0], 'progress must rise');
  }

  assert.deepEqual(options.events[0], { type: 'status', status: 'awaiting_upload' });
});

test('keeps at most four chunk puts in flight', async t => {
  const { promise, open } = createGate();
  const fake = await startApi(t, { blockChunks: promise });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(80));
  const upload = uploadFile(config, file, buildOptions(file));
  while (getPuts(fake).length < 4) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }

  await tick(20);
  assert.equal(fake.peakChunks(), 4);
  assert.equal(getPuts(fake).length, 4);
  open();
  await upload;
  assert.equal(fake.peakChunks(), 4);
  assert.equal(getPuts(fake).length, 10);
});

test('uploads a blob and a stream byte for byte', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const bytes = buildBytes(43);
  for (const kind of ['blob', 'stream'] as const) {
    const file = buildFile(bytes, kind);
    // eslint-disable-next-line no-await-in-loop
    const done = await uploadFile(config, file, buildOptions(file, { idempotencyKey: kind }));
    assert.deepEqual(fake.uploaded(done.id), bytes);
  }
});

test('puts chunks under a base url prefix without the api key', async t => {
  const fake = await startApi(t, { prefix: '/mock-api' });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(20));
  await uploadFile(config, file, buildOptions(file));
  const chunkPuts = fake.requests.filter(request => request.method === 'PUT');

  assert.equal(chunkPuts.length, 3);
  for (const put of chunkPuts) {
    assert.match(put.path, /^\/mock-api\/v1\/transcriptions\/tr_1\/upload\/chunks\/\d$/);
    assert.equal(put.headers.authorization, undefined);
    assert.match(String(put.headers['x-upload-token']), /^ut_tr_1_/);
  }
});

test('closes the source after a successful upload', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(10));
  let closed = 0;
  const { close } = file.source;
  file.source.close = async () => {
    closed++;
    return close();
  };

  await uploadFile(config, file, buildOptions(file));
  assert.equal(closed, 1);
});
