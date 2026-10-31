import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transcript1 } from '../../src/client.js';
import { download } from '../../src/download.js';
import { create } from '../../src/transcriptions/create.js';
import { get } from '../../src/transcriptions/get.js';
import { translate } from '../../src/transcriptions/translate.js';
import { expectRejection } from '../http/helpers.js';
import {
  LINK,
  createApiConfig,
  findCreates,
  findPolls,
  parseBody,
  startApi,
} from './helpers.js';

const toFile = (): Uint8Array => new TextEncoder().encode('0123456789');

test('sends translate_to for link creates only when set', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, LINK, { translateTo: 'pl' });
  await create(config, LINK, { fresh: true });
  const [first, second] = findCreates(fake);

  assert.equal((parseBody(first) as Record<string, unknown>).translate_to, 'pl');
  assert.equal('translate_to' in (parseBody(second) as object), false);
});

test('sends translate_to for upload creates', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  await create(config, toFile(), { filename: 'a.mp3', translateTo: 'de' });

  assert.equal((parseBody(findCreates(fake)[0]) as Record<string, unknown>).translate_to, 'de');
});

test('get sends translation only when set and returns translated segments', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK, { translateTo: 'pl' });
  await get(config, job.id);
  const only = await get(config, job.id, { translation: 'only' });
  const polls = findPolls(fake);

  assert.equal(polls[0]?.query.has('translation'), false);
  assert.equal(polls[1]?.query.get('translation'), 'only');
  assert.deepEqual(only.translation, { language: 'pl', status: 'completed' });
  assert.equal(only.transcript?.segments[0]?.translation, '[pl] Welcome to the show.');
  assert.equal(only.options.translate_to, 'pl');
});

test('get with wait forwards translation', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake, { sleep: async () => undefined });
  const job = await create(config, LINK);
  await get(config, job.id, { wait: true, translation: 'none' });

  assert.equal(findPolls(fake).at(-1)?.query.get('translation'), 'none');
});

test('download forwards translation', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake, { sleep: async () => undefined });
  const job = await create(config, LINK);
  await download(config, job.id, { format: 'srt', translation: 'only' });

  assert.equal(fake.requests.at(-1)?.query.get('translation'), 'only');
});

test('translate posts the language and returns the API answer', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK);
  const first = await translate(config, job.id, 'fr');
  const again = await translate(config, job.id, 'fr');
  const request = fake.requests.find(item => item.path.endsWith('/translations'));

  assert.deepEqual(first, { transcription_id: job.id, language: 'fr', status: 'completed' });
  assert.deepEqual(again, first);
  assert.equal(request?.method, 'POST');
  assert.deepEqual(parseBody(request), { language: 'fr' });
});

test('translate is on the client', async t => {
  const fake = await startApi(t);
  const t1 = new Transcript1({ apiKey: fake.knobs.key, baseUrl: fake.url });
  const job = await t1.transcriptions.create(LINK);
  const result = await t1.transcriptions.translate(job.id, 'es');

  assert.equal(result.language, 'es');
});

test('translate surfaces 404, 409 and 422 as errors', async t => {
  const fake = await startApi(t, { polls: 3 });
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK);
  const notFound = await expectRejection(translate(config, 'tr_missing', 'fr'));
  const notReady = await expectRejection(translate(config, job.id, 'fr'));
  await get(config, job.id, { wait: true });
  const invalid = await expectRejection(translate(config, job.id, 'xx1'));

  assert.equal(notFound.status, 404);
  assert.equal(notReady.status, 409);
  assert.equal(notReady.code, 'transcript_not_ready');
  assert.equal(invalid.status, 422);
});
