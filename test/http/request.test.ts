import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import { VERSION } from '../../src/version.js';
import {
  buildJsonReply,
  buildReply,
  createScriptedFetch,
  createTestConfig,
  expectRejection,
  getHeader,
} from './helpers.js';

test('sends the api key and the sdk user agent', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, { ok: true })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'GET', path: '/v1/account' });
  assert.equal(stub.calls.length, 1);
  assert.equal(stub.calls[0]?.url, 'http://api.test/v1/account');
  assert.equal(stub.calls[0]?.init.method, 'GET');
  assert.equal(getHeader(stub.calls[0], 'Authorization'), 'Bearer t1_test');
  assert.equal(getHeader(stub.calls[0], 'User-Agent'), `transcript1-sdk/${VERSION}`);
});

test('leaves out Authorization when auth is false', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'PUT', path: '/v1/x', auth: false });
  assert.equal(getHeader(stub.calls[0], 'Authorization'), null);
  assert.equal(getHeader(stub.calls[0], 'User-Agent'), `transcript1-sdk/${VERSION}`);
});

test('sends a body as json with its content type', async () => {
  const stub = createScriptedFetch([buildJsonReply(201, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'POST', path: '/v1/transcriptions', body: { url: 'https://youtu.be/x', diarize: false } });
  assert.equal(getHeader(stub.calls[0], 'Content-Type'), 'application/json');
  assert.equal(stub.calls[0]?.init.body, '{"url":"https://youtu.be/x","diarize":false}');
});

test('sends bytes and blobs as they are', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const bytes = new Uint8Array([1, 2, 3]);
  const blob = new Blob(['abc']);
  await request(config, {
    method: 'PUT',
    path: '/v1/x',
    body: bytes,
    headers: { 'X-Upload-Token': 'tok' },
  });
  await request(config, { method: 'PUT', path: '/v1/x', body: blob });
  assert.equal(stub.calls[0]?.init.body, bytes);
  assert.equal(stub.calls[1]?.init.body, blob);
  assert.equal(getHeader(stub.calls[0], 'Content-Type'), null);
  assert.equal(getHeader(stub.calls[0], 'X-Upload-Token'), 'tok');
});

test('adds the query and skips undefined values', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, {
    method: 'GET',
    path: '/v1/transcriptions',
    query: {
      limit: 5,
      status: undefined,
      wait: 0,
      q: 'a b',
    },
  });
  assert.equal(stub.calls[0]?.url, 'http://api.test/v1/transcriptions?limit=5&wait=0&q=a+b');
});

test('lets a caller header replace a default one', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'GET', path: '/v1/x', headers: { 'Idempotency-Key': 'k1', 'User-Agent': 'custom' } });
  assert.equal(getHeader(stub.calls[0], 'Idempotency-Key'), 'k1');
  assert.equal(getHeader(stub.calls[0], 'User-Agent'), 'custom');
});

test('parses a json answer', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, { id: 'tr_1' }, { 'X-Request-Id': 'r1' })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await request(config, { method: 'GET', path: '/v1/x' });
  assert.equal(result.status, 200);
  assert.deepEqual(result.json, { id: 'tr_1' });
  assert.equal(result.text, undefined);
  assert.equal(result.headers.get('X-Request-Id'), 'r1');
});

test('returns text for a non-json answer', async () => {
  const stub = createScriptedFetch([buildReply(200, '1\n00:00 hi', { 'Content-Type': 'text/plain; charset=utf-8' })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await request(config, { method: 'GET', path: '/v1/x' });
  assert.equal(result.text, '1\n00:00 hi');
  assert.equal(result.json, undefined);
});

test('returns text for a json answer when raw is set', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, { a: 1 })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await request(config, { method: 'GET', path: '/v1/x', raw: true });
  assert.equal(result.text, '{"a":1}');
  assert.equal(result.json, undefined);
});

test('returns neither json nor text for 204', async () => {
  const stub = createScriptedFetch([buildReply(204)]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const result = await request(config, { method: 'DELETE', path: '/v1/x' });
  assert.equal(result.status, 204);
  assert.equal(result.json, undefined);
  assert.equal(result.text, undefined);
});

test('fails with the http status when a success answer is not valid json', async () => {
  const stub = createScriptedFetch([buildReply(200, '{oops', { 'Content-Type': 'application/json' })]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const error = await expectRejection(request(config, { method: 'GET', path: '/v1/x' }));
  assert.equal(error.code, 'http_200');
  assert.equal(error.status, 200);
});
