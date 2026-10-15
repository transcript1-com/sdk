import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAbortedError } from '../../src/errors.js';
import { request } from '../../src/http/request.js';
import {
  buildJsonReply,
  buildReply,
  createScriptedFetch,
  createTestConfig,
  expectRejection,
} from './helpers.js';

const get = { method: 'GET', path: '/v1/account' } as const;

test('succeeds when a 503 is followed by a 200', async () => {
  const stub = createScriptedFetch([buildReply(503), buildJsonReply(200, { id: 'acct' })]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch, random: () => 0.5 });
  const result = await request(config, get);
  assert.deepEqual(result.json, { id: 'acct' });
  assert.equal(stub.calls.length, 2);
  assert.deepEqual(sleeps, [1125]);
});

test('retries 500, 502 and 504 up to maxRetries', async () => {
  const stub = createScriptedFetch([buildReply(500), buildReply(502), buildReply(504)]);
  const { config } = createTestConfig({ fetch: stub.fetch, maxRetries: 5 });
  await expectRejection(request(config, get));
  assert.equal(stub.calls.length, 6);
});

test('honors Retry-After in seconds', async () => {
  const stub = createScriptedFetch([buildReply(503, '', { 'Retry-After': '7' }), buildJsonReply(200, {})]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch, random: () => 0.9 });
  await request(config, get);
  assert.deepEqual(sleeps, [7000]);
});

test('honors a Retry-After http date', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-16T10:00:00Z') });
  const date = 'Fri, 16 Oct 2026 10:00:09 GMT';
  const stub = createScriptedFetch([buildReply(503, '', { 'Retry-After': date }), buildJsonReply(200, {})]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
  await request(config, get);
  assert.deepEqual(sleeps, [9000]);
});

test('caps Retry-After at 60 seconds', async () => {
  const stub = createScriptedFetch([buildReply(503, '', { 'Retry-After': '3600' }), buildJsonReply(200, {})]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
  await request(config, get);
  assert.deepEqual(sleeps, [60_000]);
});

test('retries a 429 by default and waits for Retry-After', async () => {
  const stub = createScriptedFetch([buildReply(429, '', { 'Retry-After': '2' }), buildJsonReply(200, {})]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
  await request(config, get);
  assert.equal(stub.calls.length, 2);
  assert.deepEqual(sleeps, [2000]);
});

test('makes one attempt when maxRetries is 0', async () => {
  const stub = createScriptedFetch([buildReply(503)]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch, maxRetries: 0 });
  const error = await expectRejection(request(config, get));
  assert.equal(error.code, 'http_503');
  assert.equal(stub.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('retries a network error and then answers network_error with the cause', async () => {
  const cause = new Error('connect ECONNREFUSED 127.0.0.1:9');
  const failure = new TypeError('fetch failed', { cause });
  const stub = createScriptedFetch([failure]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch, random: () => 0.5 });
  const error = await expectRejection(request(config, get));
  assert.equal(error.code, 'network_error');
  assert.ok(error.message.includes('ECONNREFUSED'), error.message);
  assert.equal(error.cause, failure);
  assert.equal(error.retryable, true);
  assert.equal(stub.calls.length, 3);
  assert.deepEqual(sleeps, [1125, 2250]);
});

test('recovers when a network error is followed by an answer', async () => {
  const stub = createScriptedFetch([new TypeError('fetch failed'), buildJsonReply(200, { ok: true })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await request(config, get);
  assert.deepEqual(result.json, { ok: true });
});

test('answers network_error when the body breaks off', async () => {
  const broken = () => new Response(new ReadableStream({
    pull(controller) {
      controller.error(new Error('socket hang up'));
    },
  }), { status: 200 });
  const stub = createScriptedFetch([broken]);
  const { config } = createTestConfig({ fetch: stub.fetch, maxRetries: 0 });
  const error = await expectRejection(request(config, get));
  assert.equal(error.code, 'network_error');
  assert.ok(error.message.includes('socket hang up'), error.message);
});

test('answers aborted without a request when the signal is already aborted', async () => {
  const stub = createScriptedFetch([buildReply(200)]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const error = await expectRejection(request(config, { ...get, signal: AbortSignal.abort() }));
  assert.equal(error.code, 'aborted');
  assert.equal(stub.calls.length, 0);
});

test('answers aborted without further attempts when the signal fires during a request', async () => {
  const controller = new AbortController();
  const calls: number[] = [];
  const hanging = (async (_input: unknown, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
    calls.push(1);
    init.signal?.addEventListener('abort', () => {
      reject(new DOMException('This operation was aborted', 'AbortError'));
    });
  })) as typeof fetch;
  const { config, sleeps } = createTestConfig({ fetch: hanging });
  const pending = request(config, { ...get, signal: controller.signal });
  controller.abort();
  const error = await expectRejection(pending);
  assert.equal(error.code, 'aborted');
  assert.equal(calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('answers aborted when the signal fires during a wait', async () => {
  const controller = new AbortController();
  const stub = createScriptedFetch([buildReply(503)]);
  const { config } = createTestConfig({
    fetch: stub.fetch,
    async sleep(_ms, signal) {
      controller.abort();
      if (signal?.aborted) {
        throw buildAbortedError();
      }
    },
  });
  const error = await expectRejection(request(config, { ...get, signal: controller.signal }));
  assert.equal(error.code, 'aborted');
  assert.equal(stub.calls.length, 1);
});

test('does not start another attempt when a wait ends after an abort', async () => {
  const controller = new AbortController();
  const stub = createScriptedFetch([buildReply(503)]);
  const { config } = createTestConfig({
    fetch: stub.fetch,
    async sleep() {
      controller.abort();
    },
  });
  const error = await expectRejection(request(config, { ...get, signal: controller.signal }));
  assert.equal(error.code, 'aborted');
  assert.equal(stub.calls.length, 1);
});
