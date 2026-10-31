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

test('get sends translation=none by default and mode plus language when set', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK, { translateTo: 'pl' });
  await get(config, job.id);
  const only = await get(config, job.id, { translation: { mode: 'only', language: 'pl' } });
  const polls = findPolls(fake);

  assert.equal(polls[0]?.query.get('translation'), 'none');
  assert.equal(polls[0]?.query.has('translation_language'), false);
  assert.equal(polls[1]?.query.get('translation'), 'only');
  assert.equal(polls[1]?.query.get('translation_language'), 'pl');
  assert.deepEqual(only.translation, { language: 'pl', status: 'completed' });
  assert.deepEqual(only.translations, [{ language: 'pl', status: 'completed' }]);
  assert.equal(only.transcript?.segments[0]?.translation, '[pl] Welcome to the show.');
  assert.equal(only.options.translate_to, 'pl');
});

test('get selects among several languages and rejects an unknown one', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake);
  const job = await create(config, LINK, { translateTo: 'pl' });
  await get(config, job.id);
  await translate(config, job.id, 'de');
  const german = await get(config, job.id, { translation: { mode: 'both', language: 'de' } });

  assert.deepEqual(german.translations?.map(item => item.language), ['pl', 'de']);
  assert.equal(german.translation?.language, 'de');
  assert.equal(german.transcript?.segments[0]?.translation, '[de] Welcome to the show.');
  const error = await expectRejection(get(config, job.id, { translation: { mode: 'both', language: 'fr' } }));
  assert.equal(error.code, 'translation_not_found');
  assert.equal(error.status, 404);
});

test('get with wait forwards translation and defaults to none', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake, { sleep: async () => undefined });
  const job = await create(config, LINK);
  await get(config, job.id, { wait: true });
  assert.equal(findPolls(fake).at(-1)?.query.get('translation'), 'none');
  await get(config, job.id, { wait: true, translation: { mode: 'both', language: 'pl' } }).catch(() => undefined);

  assert.equal(findPolls(fake).at(-1)?.query.get('translation'), 'both');
  assert.equal(findPolls(fake).at(-1)?.query.get('translation_language'), 'pl');
});

test('download sends none by default and forwards translation', async t => {
  const fake = await startApi(t);
  const { config } = createApiConfig(fake, { sleep: async () => undefined });
  const job = await create(config, LINK, { translateTo: 'pl' });
  await download(config, job.id, { format: 'srt' });
  assert.equal(fake.requests.at(-1)?.query.get('translation'), 'none');
  await download(config, job.id, { format: 'srt', translation: { mode: 'only', language: 'pl' } });

  assert.equal(fake.requests.at(-1)?.query.get('translation'), 'only');
  assert.equal(fake.requests.at(-1)?.query.get('translation_language'), 'pl');
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
