import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import { startFakeApi } from '../fake-api/server.js';
import {
  buildJsonReply,
  buildReply,
  createScriptedFetch,
  createTestConfig,
  expectRejection,
} from './helpers.js';

test('turns the envelope into a Transcript1Error with details', async () => {
  const envelope = {
    error: {
      code: 'insufficient_minutes',
      message: 'Not enough minutes',
      retryable: false,
      needed: 12,
      available: 3,
    },
  };
  const stub = createScriptedFetch([buildJsonReply(402, envelope)]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
  const error = await expectRejection(request(config, { method: 'POST', path: '/v1/transcriptions', body: {} }));
  assert.equal(error.code, 'insufficient_minutes');
  assert.equal(error.message, 'Not enough minutes');
  assert.equal(error.status, 402);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.details, { needed: 12, available: 3 });
  assert.equal(stub.calls.length, 1);
  assert.deepEqual(sleeps, []);
});

test('reads a wrong key from the fake api as unauthorized without retrying', async t => {
  const fake = await startFakeApi();
  t.after(async () => fake.close());
  const { config } = createTestConfig({ apiKey: 'wrong', baseUrl: fake.url, fetch: globalThis.fetch });
  const error = await expectRejection(request(config, { method: 'GET', path: '/v1/account' }));
  assert.equal(error.code, 'unauthorized');
  assert.equal(error.status, 401);
  assert.equal(fake.requests.length, 1);
});

test('reads the fake api not_found envelope', async t => {
  const fake = await startFakeApi();
  t.after(async () => fake.close());
  const { config } = createTestConfig({ baseUrl: fake.url, fetch: globalThis.fetch });
  const error = await expectRejection(request(config, { method: 'GET', path: '/v1/transcriptions/tr_missing' }));
  assert.equal(error.code, 'not_found');
  assert.equal(error.status, 404);
});

test('answers a non-json 502 with http_502 after three attempts', async () => {
  const stub = createScriptedFetch([buildReply(502, '<html>Bad gateway</html>', { 'Content-Type': 'text/html' })]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch, random: () => 0.999 });
  const error = await expectRejection(request(config, { method: 'GET', path: '/v1/account' }));
  assert.equal(error.code, 'http_502');
  assert.equal(error.message, 'the server answered HTTP 502');
  assert.equal(error.status, 502);
  assert.equal(error.retryable, true);
  assert.equal(stub.calls.length, 3);
  assert.equal(sleeps.length, 2);
  assert.ok(sleeps[0]! >= 1000 && sleeps[0]! < 1250, `first wait ${sleeps[0]}`);
  assert.ok(sleeps[1]! >= 2000 && sleeps[1]! < 2500, `second wait ${sleeps[1]}`);
});

test('does not retry other 4xx or 501', async () => {
  for (const status of [400, 404, 409, 422, 501]) {
    const stub = createScriptedFetch([buildReply(status)]);
    const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
    // eslint-disable-next-line no-await-in-loop
    const error = await expectRejection(request(config, { method: 'GET', path: '/v1/x' }));
    assert.equal(error.code, `http_${status}`);
    assert.equal(stub.calls.length, 1);
    assert.deepEqual(sleeps, []);
  }
});

test('answers a 429 with retry_after in details when retry429 is false', async () => {
  const envelope = {
    error: {
      code: 'too_many_active_jobs',
      message: 'Too many jobs',
      retryable: true,
      limit: 2,
    },
  };
  const stub = createScriptedFetch([buildJsonReply(429, envelope, { 'Retry-After': '7' })]);
  const { config, sleeps } = createTestConfig({ fetch: stub.fetch });
  const error = await expectRejection(request(config, {
    method: 'POST',
    path: '/v1/transcriptions',
    body: {},
    retry429: false,
  }));
  assert.equal(error.code, 'too_many_active_jobs');
  assert.equal(error.status, 429);
  assert.equal(error.retryable, true);
  assert.deepEqual(error.details, { limit: 2, retry_after: 7 });
  assert.equal(stub.calls.length, 1);
  assert.deepEqual(sleeps, []);
});
