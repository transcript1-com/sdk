import assert from 'node:assert/strict';
import { test } from 'node:test';
import { create } from '../../src/transcriptions/create.js';
import { get } from '../../src/transcriptions/get.js';
import { waitFor } from '../../src/transcriptions/wait-for.js';
import { expectRejection } from '../http/helpers.js';
import {
  LINK,
  createApiConfig,
  createRecorder,
  filterByType,
  findPolls,
  getStatuses,
  hookBeforePoll,
  startApi,
} from './helpers.js';

test('returns a terminal transcription at once without a request', async t => {
  const fake = await startApi(t);
  const { config, sleeps } = createApiConfig(fake);
  const created = await create(config, LINK);
  const done = await get(config, created.id);
  const again = await waitFor(config, done.id, { transcription: done });

  assert.equal(again, done);
  assert.equal(findPolls(fake).length, 1);
  assert.deepEqual(sleeps, []);
});

test('makes one poll when the job has already ended', async t => {
  const fake = await startApi(t);
  const { config, sleeps } = createApiConfig(fake);
  const created = await create(config, LINK);
  await get(config, created.id);
  const done = await get(config, created.id, { wait: true });

  assert.equal(done.status, 'completed');
  assert.equal(findPolls(fake).length, 2);
  assert.deepEqual(sleeps, []);
});

test('resolves with a failed job, because waiting is a read', async t => {
  const fake = await startApi(t, { failCode: 'no_speech' });
  const { config } = createApiConfig(fake);
  const created = await create(config, LINK);
  const done = await waitFor(config, created.id, { transcription: created });

  assert.equal(done.status, 'failed');
  assert.equal(done.error?.code, 'no_speech');
});

test('adds no delay after a server that held the poll for 60 s', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 3 });
  const held = () => {
    t.mock.timers.tick(60_000);
  };

  const { config, sleeps } = createApiConfig(fake, { fetch: hookBeforePoll({ 1: held, 2: held, 3: held }) });
  const created = await create(config, LINK);
  await waitFor(config, created.id, {});

  assert.equal(findPolls(fake).length, 3);
  assert.deepEqual(sleeps, []);
});

test('sleeps only the rest of the 2 s gap after a quick answer', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 2 });
  const { config, sleeps } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      1() {
        t.mock.timers.tick(500);
      },
    }),
  });
  const created = await create(config, LINK);
  await waitFor(config, created.id, {});

  assert.deepEqual(sleeps, [1500]);
});

test('emits the first observed status, even when it is the one it started from', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 2 });
  const { config } = createApiConfig(fake);
  const progress = createRecorder();
  const created = await create(config, LINK);
  await waitFor(config, created.id, { transcription: created, onProgress: progress.onProgress });

  assert.deepEqual(getStatuses(progress.events), ['queued', 'transcribing', 'completed']);
});

test('reconnects through three 503 answers with backoffs of 2, 4 and 8 s and one event', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { pollErrors: [503, 503, 503] });
  const { config, sleeps } = createApiConfig(fake, { maxRetries: 0 });
  const progress = createRecorder();
  const created = await create(config, LINK);
  const done = await waitFor(config, created.id, { onProgress: progress.onProgress });

  assert.equal(done.status, 'completed');
  assert.deepEqual(sleeps, [2000, 4000, 8000]);
  assert.equal(filterByType(progress.events, 'reconnecting').length, 1);
  assert.equal(findPolls(fake).length, 4);
});

test('reconnects through two dropped connections with backoffs of 2 and 4 s', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { dropPolls: 2 });
  const { config, sleeps } = createApiConfig(fake, { maxRetries: 0 });
  const progress = createRecorder();
  const created = await create(config, LINK);
  const done = await waitFor(config, created.id, { onProgress: progress.onProgress });

  assert.equal(done.status, 'completed');
  assert.deepEqual(sleeps, [2000, 4000]);
  assert.deepEqual(progress.events.map(event => event.type), ['reconnecting', 'status']);
});

test('caps the reconnect backoff at 30 s and keeps trying', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { pollErrors: [503, 502, 500, 504, 429, 503, 503] });
  const { config, sleeps } = createApiConfig(fake, { maxRetries: 0 });
  const created = await create(config, LINK);
  const done = await waitFor(config, created.id, {});

  assert.equal(done.status, 'completed');
  assert.deepEqual(sleeps, [2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000]);
});

test('starts a new outage with one more event and a 2 s backoff after a good answer', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 3 });
  const drop = () => {
    throw new TypeError('fetch failed');
  };

  const { config, sleeps } = createApiConfig(fake, { maxRetries: 0, fetch: hookBeforePoll({ 1: drop, 3: drop }) });
  const progress = createRecorder();
  const created = await create(config, LINK);
  const done = await waitFor(config, created.id, { onProgress: progress.onProgress });

  assert.equal(done.status, 'completed');
  assert.deepEqual(sleeps, [2000, 2000, 2000, 2000]);
  assert.equal(filterByType(progress.events, 'reconnecting').length, 2);
});

test('rejects with the job id when the job disappears mid-wait', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 3 });
  const { config } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      async 2() {
        const path = `${fake.url}/v1/transcriptions/tr_1`;
        const init = { method: 'DELETE', headers: { Authorization: 'Bearer t1_test' } };
        await fetch(path, init);
        await fetch(path, init);
      },
    }),
  });
  const created = await create(config, LINK);
  const error = await expectRejection(waitFor(config, created.id, {}));

  assert.equal(error.code, 'not_found');
  assert.equal(error.transcriptionId, created.id);
});

test('ends with aborted, the job id and the last transcription, and never deletes the job', async t => {
  t.mock.timers.enable({ apis: ['Date'] });
  const fake = await startApi(t, { polls: 3 });
  const controller = new AbortController();
  const { config } = createApiConfig(fake, {
    fetch: hookBeforePoll({
      2() {
        controller.abort();
      },
    }),
  });
  const created = await create(config, LINK);
  const error = await expectRejection(waitFor(config, created.id, { signal: controller.signal }));

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, created.id);
  assert.equal(error.transcription?.status, 'transcribing');
  assert.equal(fake.requests.filter(request => request.method === 'DELETE').length, 0);
});

test('ends with aborted during a reconnect backoff', async t => {
  const fake = await startApi(t, { pollErrors: [503] });
  const controller = new AbortController();
  const { config } = createApiConfig(fake, { maxRetries: 0 });
  const created = await create(config, LINK);
  const waiting = waitFor(config, created.id, {
    signal: controller.signal,
    onProgress(event) {
      if (event.type === 'reconnecting') {
        controller.abort();
      }
    },
  });
  const error = await expectRejection(waiting);

  assert.equal(error.code, 'aborted');
  assert.equal(error.transcriptionId, created.id);
});
