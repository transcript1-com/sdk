import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from '../../src/http/request.js';
import { startFakeApi } from '../fake-api/server.js';
import { createTestConfig } from './helpers.js';

const created = {
  method: 'POST',
  path: '/v1/transcriptions',
  body: {
    upload: { filename: 'a.mp3', size: 20, mime_type: 'audio/mpeg' },
    source: 'auto',
    language: 'auto',
    diarize: false,
  },
  headers: { 'Idempotency-Key': 'k1' },
} as const;

type CreatedType = {
  id: string;
  upload: { chunk_url_template: string; headers: Record<string, string> };
};

test('resolves every request under a base url prefix with a trailing slash', async t => {
  const fake = await startFakeApi({ prefix: '/mock-api' });
  t.after(async () => fake.close());
  const { config } = createTestConfig({ baseUrl: `${fake.url}/`, fetch: globalThis.fetch });

  const account = await request(config, { method: 'GET', path: '/v1/account' });
  assert.equal(account.status, 200);
  await request(config, { ...created, query: { wait: 0 } });
  assert.deepEqual(fake.requests.map(({ method, path }) => `${method} ${path}`), [
    'GET /mock-api/v1/account',
    'POST /mock-api/v1/transcriptions',
  ]);
});

test('puts a path-only chunk url under the prefix without doubling it', async t => {
  const fake = await startFakeApi({ prefix: '/mock-api' });
  t.after(async () => fake.close());
  const { config } = createTestConfig({ baseUrl: `${fake.url}/`, fetch: globalThis.fetch });

  const { json } = await request(config, created);
  const { id, upload } = json as CreatedType;
  assert.ok(upload.chunk_url_template.startsWith('/mock-api/v1/'));
  const path = upload.chunk_url_template.replace('{index}', '0');
  const sent = await request(config, {
    method: 'PUT',
    path,
    body: new Uint8Array(8),
    headers: upload.headers,
    auth: false,
  });
  assert.equal(sent.status, 200);
  const put = fake.requests.find(({ method }) => method === 'PUT');
  assert.equal(put?.path, `/mock-api/v1/transcriptions/${id}/upload/chunks/0`);
  assert.equal(put?.headers.authorization, undefined);
});

test('puts a chunk url without the prefix under the prefix', async t => {
  const fake = await startFakeApi({ prefix: '/mock-api' });
  t.after(async () => fake.close());
  const { config } = createTestConfig({ baseUrl: fake.url, fetch: globalThis.fetch });

  const { json } = await request(config, created);
  const { id, upload } = json as CreatedType;
  const path = upload.chunk_url_template.replace('/mock-api', '').replace('{index}', '1');
  await request(config, {
    method: 'PUT',
    path,
    body: new Uint8Array(8),
    headers: upload.headers,
    auth: false,
  });
  const put = fake.requests.find(({ method }) => method === 'PUT');
  assert.equal(put?.path, `/mock-api/v1/transcriptions/${id}/upload/chunks/1`);
});
