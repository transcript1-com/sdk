import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { Transcript1 } from '../src/client.js';
import { Transcript1Error } from '../src/errors.js';
import { expectRejection } from './http/helpers.js';
import { LINK, startApi } from './transcriptions/helpers.js';

const createClient = (url: string, extra: { maxRetries?: number } = {}) => new Transcript1({ apiKey: 't1_test', baseUrl: url, ...extra });

test('fails at construction without an API key', () => {
  const saved = process.env.TRANSCRIPT1_API_KEY;
  Reflect.deleteProperty(process.env, 'TRANSCRIPT1_API_KEY');
  try {
    assert.throws(() => new Transcript1(), (error: unknown) => {
      assert.ok(error instanceof Transcript1Error);
      assert.equal(error.code, 'missing_api_key');
      return true;
    });
  } finally {
    if (saved !== undefined) {
      process.env.TRANSCRIPT1_API_KEY = saved;
    }
  }
});

test('transcribes a link and downloads its srt', async t => {
  const fake = await startApi(t);
  const t1 = createClient(fake.url);
  const done = await t1.transcribe(LINK);
  const srt = await t1.download(done.id, { format: 'srt' });

  assert.equal(done.status, 'completed');
  assert.ok(done.transcript?.text);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:03,200\n/);
});

test('creates a job at once and reads it, with and without waiting', async t => {
  const fake = await startApi(t, { polls: 1 });
  const t1 = createClient(fake.url);
  const job = await t1.transcriptions.create(LINK);
  const current = await t1.transcriptions.get(job.id);
  const finished = await t1.transcriptions.get(job.id, { wait: true });

  assert.equal(job.status, 'queued');
  assert.equal(current.status, 'completed');
  assert.equal(finished.status, 'completed');
  assert.ok(finished.transcript);
});

test('lists transcriptions across pages', async t => {
  const fake = await startApi(t, { pageSize: 2 });
  const t1 = createClient(fake.url);
  const jobs = [
    await t1.transcriptions.create(LINK, { fresh: true }),
    await t1.transcriptions.create(LINK, { fresh: true }),
    await t1.transcriptions.create(LINK, { fresh: true }),
  ];
  const ids = jobs.map(job => job.id);
  const seen: string[] = [];
  for await (const item of t1.transcriptions.list({ limit: 2 })) {
    seen.push(item.id);
  }

  assert.deepEqual(seen.sort(), ids.sort());
});

test('deletes a transcription', async t => {
  const fake = await startApi(t);
  const t1 = createClient(fake.url);
  const job = await t1.transcriptions.create(LINK);
  await t1.transcriptions.delete(job.id);
  await t1.transcriptions.delete(job.id);
  const error = await expectRejection(t1.transcriptions.get(job.id));

  assert.equal(error.code, 'not_found');
});

test('reads the account', async t => {
  const fake = await startApi(t);
  const t1 = createClient(fake.url);
  const account = await t1.account();

  assert.equal(account.object, 'account');
});

test('keeps working when transcriptions methods are taken apart', async t => {
  const fake = await startApi(t);
  const { create, get } = createClient(fake.url).transcriptions;
  const job = await create(LINK);
  const read = await get(job.id);

  assert.equal(read.id, job.id);
});

test('keeps working when transcribe, download and account are taken apart', async t => {
  const fake = await startApi(t);
  const { transcribe, download, account } = createClient(fake.url);
  const done = await transcribe(LINK);
  const text = await download(done.id);
  const current = await account();

  assert.equal(done.status, 'completed');
  assert.ok(text);
  assert.equal(current.object, 'account');
});

test('runs many transcriptions at once on one client within its job slots', async t => {
  const fake = await startApi(t, { activeLimit: 2 });
  const t1 = createClient(fake.url);
  const done = await Promise.all(Array.from({ length: 3 }, async () => t1.transcribe(LINK, { fresh: true })));

  assert.equal(new Set(done.map(job => job.id)).size, 3);
  assert.ok(fake.peakActive() <= 2);
});
