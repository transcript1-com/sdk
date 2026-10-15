import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { classifyData } from '../../src/inputs/classify-data.js';
import type { FileInputType } from '../../src/inputs/types.js';
import { uploadFile } from '../../src/uploads/upload-file.js';
import type { FakeApiType } from '../fake-api/server.js';
import { createTestConfig, expectRejection } from '../http/helpers.js';
import {
  buildBytes,
  buildFile,
  buildOptions,
  countRequests,
  createGate,
  createUploadConfig,
  getPuts,
  startApi,
  tick,
} from './helpers.js';

const countCloses = (file: FileInputType): { closes: number } => {
  const counter = { closes: 0 };
  const { close } = file.source;
  file.source.close = async () => {
    counter.closes++;
    return close();
  };

  return counter;
};

const getStatus = async (fake: FakeApiType, id: string): Promise<string> => {
  const reply = await fetch(`${fake.url}/v1/transcriptions/${id}`, { headers: { Authorization: `Bearer ${fake.knobs.key}` } });
  const job = await reply.json() as { status: string };

  return job.status;
};

const streamCases = [
  ['shorter', 20, /ended before 30 bytes/],
  ['longer', 40, /longer than 30 bytes/],
] as const;

for (const [name, real, message] of streamCases) {
  test(`fails a stream ${name} than its size with invalid_input and deletes the job`, async t => {
    const fake = await startApi(t);
    const { config } = createUploadConfig(fake);
    const file = buildFile(buildBytes(real), 'stream', 30);
    const counter = countCloses(file);
    const error = await expectRejection(uploadFile(config, file, buildOptions(file)));

    assert.equal(error.code, 'invalid_input');
    assert.match(error.message, message);
    assert.equal(error.transcriptionId, 'tr_1');
    assert.equal(countRequests(fake, 'DELETE', /^\/v1\/transcriptions\/tr_1$/), 1);
    assert.equal(await getStatus(fake, 'tr_1'), 'canceled');
    assert.equal(countRequests(fake, 'POST', /\/upload\/complete$/), 0);
    assert.equal(counter.closes, 1);
  });
}

test('rejects once when one chunk fails while others are in flight, aborting them', async t => {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.off('unhandledRejection', onUnhandled));
  const fake = await startApi(t, { blockChunks: createGate().promise });
  const aborted: string[] = [];
  const failing = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/upload/chunks/0')) {
      while (getPuts(fake).length < 3) {
        // eslint-disable-next-line no-await-in-loop
        await tick();
      }

      const error = {
        code: 'invalid_request',
        message: 'Bad chunk',
        retryable: false,
      };
      const body = JSON.stringify({ error });
      return new Response(body, { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    return fetch(input, init).catch((error: unknown) => {
      aborted.push(url);
      throw error;
    });
  }) as typeof fetch;
  const { config } = createTestConfig({ fetch: failing, baseUrl: fake.url });
  const file = buildFile(buildBytes(64));
  const counter = countCloses(file);
  const error = await expectRejection(uploadFile(config, file, buildOptions(file)));
  await tick(30);

  assert.equal(error.code, 'invalid_request');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(aborted.length, 3);
  assert.deepEqual(getPuts(fake).sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(counter.closes, 1);
  assert.deepEqual(unhandled, []);
});

test('cancels the job when the caller aborts mid-upload', async t => {
  const fake = await startApi(t, { blockChunks: createGate().promise });
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(64));
  const counter = countCloses(file);
  const controller = new AbortController();
  const upload = uploadFile(config, file, buildOptions(file, { signal: controller.signal }));
  while (getPuts(fake).length < 4) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }

  controller.abort();
  const error = await expectRejection(upload);

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(countRequests(fake, 'GET', /^\/v1\/transcriptions\/tr_1$/), 1);
  assert.equal(countRequests(fake, 'DELETE', /^\/v1\/transcriptions\/tr_1$/), 1);
  assert.equal(await getStatus(fake, 'tr_1'), 'canceled');
  assert.equal(counter.closes, 1);
});

test('fails with aborted and sends nothing when the signal is already aborted', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const file = buildFile(buildBytes(16));
  const counter = countCloses(file);
  const error = await expectRejection(uploadFile(config, file, buildOptions(file, { signal: AbortSignal.abort() })));

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, undefined);
  assert.equal(fake.requests.length, 0);
  assert.equal(counter.closes, 1);
});

test('cancels a stalled stream upload when the caller aborts', async t => {
  const fake = await startApi(t);
  const { config } = createUploadConfig(fake);
  const stalled = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(buildBytes(12));
    },
  });
  const file = classifyData(stalled, { filename: 'talk.mp3', size: 30 });
  const controller = new AbortController();
  const upload = uploadFile(config, file, buildOptions(file, { signal: controller.signal }));
  while (getPuts(fake).length === 0) {
    // eslint-disable-next-line no-await-in-loop
    await tick();
  }

  await tick(10);
  controller.abort();
  const error = await expectRejection(upload);

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(await getStatus(fake, 'tr_1'), 'canceled');
});
