import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAccount } from '../src/account.js';
import { createTestConfig, expectRejection } from './http/helpers.js';
import { startApi } from './uploads/helpers.js';

test('returns the account object as the API sent it', async t => {
  const fake = await startApi(t, { minutesLeft: 42, activeLimit: 2 });
  const { config } = createTestConfig({ baseUrl: fake.url });
  const current = await getAccount(config);

  assert.equal(current.object, 'account');
  assert.equal(current.minutes.remaining, 42);
  assert.equal(current.limits.max_active_jobs, 2);
  assert.equal(fake.log.at(-1), 'GET /v1/account');
});

test('rejects a wrong key with unauthorized', async t => {
  const fake = await startApi(t);
  const { config } = createTestConfig({ baseUrl: fake.url, apiKey: 't1_wrong' });
  const error = await expectRejection(getAccount(config));

  assert.equal(error.code, 'unauthorized');
  assert.equal(error.status, 401);
});
