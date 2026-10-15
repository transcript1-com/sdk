import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveUrl } from '../../src/http/url.js';

test('appends a v1 path to the base url', () => {
  assert.equal(resolveUrl('https://api.transcript1.com', '/v1/account'), 'https://api.transcript1.com/v1/account');
});

test('keeps the path prefix of the base url', () => {
  assert.equal(resolveUrl('http://127.0.0.1:3000/mock-api', '/v1/account'), 'http://127.0.0.1:3000/mock-api/v1/account');
});

test('ignores a trailing slash on the base url', () => {
  assert.equal(resolveUrl('http://127.0.0.1:3000/mock-api/', '/v1/account'), 'http://127.0.0.1:3000/mock-api/v1/account');
  assert.equal(resolveUrl('http://127.0.0.1:3000/', '/v1/account'), 'http://127.0.0.1:3000/v1/account');
});

test('does not double the prefix of a path that already carries it', () => {
  const path = '/mock-api/v1/transcriptions/tr_1/upload/chunks/0';
  assert.equal(resolveUrl('http://127.0.0.1:3000/mock-api', path), `http://127.0.0.1:3000${path}`);
  assert.equal(resolveUrl('http://127.0.0.1:3000/mock-api/', path), `http://127.0.0.1:3000${path}`);
});

test('adds the prefix to a path-only url that lacks it', () => {
  const resolved = resolveUrl('http://127.0.0.1:3000/mock-api', '/v1/transcriptions/tr_1/upload/chunks/0');
  assert.equal(resolved, 'http://127.0.0.1:3000/mock-api/v1/transcriptions/tr_1/upload/chunks/0');
});

test('does not mistake a longer segment for the prefix', () => {
  assert.equal(resolveUrl('http://h.test/api', '/api-v2/v1/x'), 'http://h.test/api/api-v2/v1/x');
});

test('passes absolute urls through', () => {
  assert.equal(resolveUrl('http://127.0.0.1:3000/mock-api', 'https://other.test/up/1?x=1'), 'https://other.test/up/1?x=1');
  assert.equal(resolveUrl('http://127.0.0.1:3000', 'http://other.test/up'), 'http://other.test/up');
});

test('adds the missing leading slash to a relative path', () => {
  assert.equal(resolveUrl('http://h.test/p', 'v1/account'), 'http://h.test/p/v1/account');
});
