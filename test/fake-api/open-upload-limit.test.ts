import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startFakeApi, type FakeApiType } from './server.js';

type ErrorReplyType = {
  error: {
    code: string;
    retryable: boolean;
  };
};

const body = {
  upload: {
    filename: 'a.mp3',
    size: 20,
    mime_type: 'audio/mpeg',
  },
  language: 'auto',
  diarize: false,
};

const createUpload = async (fake: FakeApiType, key: string) => fetch(`${fake.url}/v1/transcriptions`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${fake.knobs.key}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': key,
  },
  body: JSON.stringify(body),
});

test('answers 429 too_many_active_jobs on an upload create while openUploadLimit uploads are open', async t => {
  const fake = await startFakeApi({ openUploadLimit: 1 });
  t.after(async () => fake.close());
  const first = await createUpload(fake, 'k1');
  const second = await createUpload(fake, 'k2');
  const replayed = await createUpload(fake, 'k1');
  const { error } = await second.json() as ErrorReplyType;

  assert.equal(first.status, 201);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '1');
  assert.equal(error.code, 'too_many_active_jobs');
  assert.equal(error.retryable, true);
  assert.equal(replayed.status, 201);

  await fetch(`${fake.url}/v1/transcriptions/tr_1`, { method: 'DELETE', headers: { Authorization: `Bearer ${fake.knobs.key}` } });
  const third = await createUpload(fake, 'k2');

  assert.equal(third.status, 201);
});
