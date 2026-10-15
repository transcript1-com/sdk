import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import {
  buildJsonReply,
  createScriptedFetch,
  createTestConfig,
  expectRejection,
  getHeader,
} from './helpers.js';

test('never sends the api key to another host', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'PUT', path: 'https://uploads.example.com/chunks/0', body: new Uint8Array([1]) });
  assert.equal(stub.calls[0]?.url, 'https://uploads.example.com/chunks/0');
  assert.equal(getHeader(stub.calls[0], 'Authorization'), null);
});

test('never sends the api key to another port or scheme of the same host', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch, baseUrl: 'http://api.test:8080' });
  await request(config, { method: 'GET', path: 'http://api.test:9090/v1/x' });
  await request(config, { method: 'GET', path: 'https://api.test:8080/v1/x' });
  assert.equal(getHeader(stub.calls[0], 'Authorization'), null);
  assert.equal(getHeader(stub.calls[1], 'Authorization'), null);
});

test('sends the api key to an absolute url on the base origin', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch, baseUrl: 'http://api.test/prefix' });
  await request(config, { method: 'GET', path: 'http://api.test/prefix/v1/x' });
  assert.equal(getHeader(stub.calls[0], 'Authorization'), 'Bearer t1_test');
});

test('sends an array body as json', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  await request(config, { method: 'POST', path: '/v1/x', body: [1, 2] });
  assert.equal(stub.calls[0]?.init.body, '[1,2]');
});

test('sends an object without a prototype as json', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const body = Object.assign(Object.create(null) as Record<string, unknown>, { a: 1 });
  await request(config, { method: 'POST', path: '/v1/x', body });
  assert.equal(stub.calls[0]?.init.body, '{"a":1}');
});

test('refuses a body of an unknown type without sending it', async () => {
  const stub = createScriptedFetch([buildJsonReply(200, {})]);
  const { config } = createTestConfig({ fetch: stub.fetch });
  const bodies: unknown[] = ['text', 42, true, null, new Date(), new Map(), new ArrayBuffer(2), new ReadableStream()];
  for (const body of bodies) {
    // eslint-disable-next-line no-await-in-loop
    const error = await expectRejection(request(config, { method: 'POST', path: '/v1/x', body }));
    assert.equal(error.code, 'invalid_input');
  }

  assert.equal(stub.calls.length, 0);
});
