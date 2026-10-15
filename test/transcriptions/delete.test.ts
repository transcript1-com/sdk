import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from '../../src/transcriptions/create.js';
import { remove } from '../../src/transcriptions/delete.js';
import { get } from '../../src/transcriptions/get.js';
import { expectRejection } from '../http/helpers.js';
import { LINK, createApiConfig, startApi } from './helpers.js';

test('cancels a running job with one DELETE and resolves with nothing', async t => {
  const fake = await startApi(t, { polls: 3 });
  const { config } = createApiConfig(fake);
  const created = await create(config, LINK);

  await remove(config, created.id);

  assert.equal(fake.log.at(-1), `DELETE /v1/transcriptions/${created.id}`);
  const after = await get(config, created.id);
  assert.equal(after.status, 'canceled');
});

test('rejects the delete of an unknown job with not_found', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const error = await expectRejection(remove(config, 'tr_404'));

  assert.equal(error.code, 'not_found');
});
