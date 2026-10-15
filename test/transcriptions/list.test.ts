import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transcript1Error } from '../../src/errors.js';
import { create } from '../../src/transcriptions/create.js';
import { list } from '../../src/transcriptions/list.js';
import type { TranscriptionSummary } from '../../src/types.js';
import type { FakeApiType, RecordedRequestType } from '../fake-api/server.js';
import { LINK, createApiConfig, startApi } from './helpers.js';

const collectItems = async (items: AsyncIterable<TranscriptionSummary>): Promise<TranscriptionSummary[]> => {
  const all: TranscriptionSummary[] = [];
  for await (const item of items) {
    all.push(item);
  }

  return all;
};

const isListCall = (request: RecordedRequestType): boolean => {
  if (request.method !== 'GET') {
    return false;
  }

  return request.path === '/v1/transcriptions';
};

const findListCalls = (fake: FakeApiType) => fake.requests.filter(request => isListCall(request));

test('lists every transcription newest first across pages of cursors', async t => {
  const fake = await startApi(t, { pageSize: 2 });
  const { config } = createApiConfig(fake);
  for (let index = 0; index < 5; index++) {
    // eslint-disable-next-line no-await-in-loop
    await create(config, LINK, { fresh: true });
  }

  const items = await collectItems(list(config));
  const calls = findListCalls(fake);

  assert.deepEqual(items.map(item => item.id), ['tr_5', 'tr_4', 'tr_3', 'tr_2', 'tr_1']);
  assert.equal(items[0]?.object, 'transcription');
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.query.get('cursor'), null);
  assert.ok(calls[1]?.query.get('cursor'));
  assert.ok(calls[2]?.query.get('cursor'));
});

test('passes status, platform and limit to every page', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, LINK, { fresh: true });
  await create(config, LINK, { fresh: true });
  const items = await collectItems(list(config, { status: 'queued', platform: 'youtube', limit: 1 }));
  const calls = findListCalls(fake);

  assert.equal(items.length, 2);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.query.get('status'), 'queued');
    assert.equal(call.query.get('platform'), 'youtube');
    assert.equal(call.query.get('limit'), '1');
  }
});

test('stops after an empty first page', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);

  assert.deepEqual(await collectItems(list(config)), []);
  assert.equal(findListCalls(fake).length, 1);
});

test('refuses a limit outside 1 to 100 before any request', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  for (const limit of [0, 101, 1.5]) {
    assert.throws(() => list(config, { limit }), (error: unknown) => {
      assert.ok(error instanceof Transcript1Error);
      assert.equal(error.code, 'invalid_input');
      return true;
    });
  }

  assert.equal(fake.requests.length, 0);
});
