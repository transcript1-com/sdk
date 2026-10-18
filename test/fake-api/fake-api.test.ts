/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, no-await-in-loop, unicorn/no-await-expression-member */
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { startFakeApi, type FakeApiType, type KnobsType } from './server.js';

type ReplyType = {
  status: number;
  headers: Headers;
  text: string;
  json: any;
};

type CallOptionsType = {
  key?: string | undefined;
  headers?: Record<string, string>;
  body?: unknown;
};

const startApi = async (t: TestContext, options?: Partial<KnobsType>): Promise<FakeApiType> => {
  const fake = await startFakeApi(options);
  t.after(async () => fake.close());

  return fake;
};

const isJsonBody = (raw: unknown): boolean => {
  if (raw === undefined) {
    return false;
  }

  return !(raw instanceof Uint8Array);
};

const buildHeaders = (key: string | undefined, raw: unknown, headers: Record<string, string> = {}) => {
  const built: Record<string, string> = {};
  if (key) {
    built.Authorization = `Bearer ${key}`;
  }

  if (isJsonBody(raw)) {
    built['Content-Type'] = 'application/json';
  }

  return { ...built, ...headers };
};

const buildBody = (raw: unknown) => {
  if (raw === undefined) {
    return undefined;
  }

  if (raw instanceof Uint8Array) {
    return raw as Uint8Array<ArrayBuffer>;
  }

  return JSON.stringify(raw);
};

const parseText = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const getKey = (fake: FakeApiType, options: CallOptionsType): string | undefined => {
  if ('key' in options) {
    return options.key;
  }

  return fake.knobs.key;
};

const callApi = async (fake: FakeApiType, method: string, path: string, options: CallOptionsType = {}): Promise<ReplyType> => {
  const key = getKey(fake, options);
  const response = await fetch(fake.url + path, {
    method,
    headers: buildHeaders(key, options.body, options.headers),
    body: buildBody(options.body),
  });
  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    text,
    json: parseText(text),
  };
};

const link = { platform: 'youtube', url: 'https://youtu.be/dQw4w9WgXcQ' };

const uploadBody = {
  upload: { filename: 'a.mp3', size: 20, mime_type: 'audio/mpeg' },
  language: 'auto',
  diarize: false,
};

test('answers a wrong key with 401 in the error envelope', async t => {
  const fake = await startApi(t);
  const reply = await callApi(fake, 'GET', '/v1/account', { key: 'wrong' });

  assert.equal(reply.status, 401);
  assert.equal(reply.json.error.code, 'unauthorized');
  assert.equal(reply.json.error.retryable, false);
  assert.ok(reply.json.error.message);
  assert.ok(reply.headers.get('www-authenticate'));
});

test('answers an unknown id with 404 not_found', async t => {
  const fake = await startApi(t);
  const reply = await callApi(fake, 'GET', '/v1/transcriptions/tr_nope');

  assert.equal(reply.status, 404);
  assert.equal(reply.json.error.code, 'not_found');
});

test('shows the demo account with unlimited minutes as 1000', async t => {
  const fake = await startApi(t);
  const reply = await callApi(fake, 'GET', '/v1/account');

  assert.equal(reply.status, 200);
  assert.equal(reply.json.object, 'account');
  assert.equal(reply.json.user.email, 'demo@transcript1.com');
  assert.equal(reply.json.plan.name, 'Monthly');
  assert.equal(reply.json.minutes.remaining, 1000);
  assert.equal(reply.json.limits.max_active_jobs, 10);
});

test('answers 429 too_many_active_jobs with Retry-After over the active limit', async t => {
  const fake = await startApi(t, { activeLimit: 1 });
  const first = await callApi(fake, 'POST', '/v1/transcriptions', { body: link });
  const second = await callApi(fake, 'POST', '/v1/transcriptions', { body: link });

  assert.equal(first.status, 202);
  assert.equal(second.status, 429);
  assert.equal(second.json.error.code, 'too_many_active_jobs');
  assert.equal(second.json.error.retryable, true);
  assert.equal(second.headers.get('retry-after'), '1');
  assert.equal(fake.peakActive(), 1);
});

test('answers 402 insufficient_minutes with the shortfall', async t => {
  const fake = await startApi(t, { minutesLeft: 0, minutesPerJob: 3 });
  const reply = await callApi(fake, 'POST', '/v1/transcriptions', { body: link });

  assert.equal(reply.status, 402);
  assert.equal(reply.json.error.code, 'insufficient_minutes');
  assert.equal(reply.json.error.minutes_needed, 3);
  assert.equal(reply.json.error.minutes_remaining, 0);
  assert.ok(reply.json.error.action_url);
});

const createUpload = async (fake: FakeApiType, key: string, body: unknown = uploadBody) => callApi(fake, 'POST', '/v1/transcriptions', {
  headers: { 'Idempotency-Key': key },
  body,
});

const putChunk = async (fake: FakeApiType, created: ReplyType, index: number, bytes: string) => callApi(fake, 'PUT', `/v1/transcriptions/${created.json.id}/upload/chunks/${index}`, {
  key: undefined,
  headers: { 'X-Upload-Token': created.json.upload.headers['X-Upload-Token'] },
  body: new TextEncoder().encode(bytes),
});

test('rotates the upload token when a create repeats with the same key', async t => {
  const fake = await startApi(t);
  const first = await createUpload(fake, 'k1');
  const second = await createUpload(fake, 'k1');
  const { id } = first.json;

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(second.json.id, id);
  assert.equal(first.json.status, 'awaiting_upload');
  assert.ok(first.json.upload.headers['X-Upload-Token']);
  assert.notEqual(first.json.upload.headers['X-Upload-Token'], second.json.upload.headers['X-Upload-Token']);

  const old = await putChunk(fake, first, 0, '01234567');
  assert.equal(old.status, 401);
  assert.equal(old.json.error.code, 'unauthorized');

  const fresh = await putChunk(fake, second, 0, '01234567');
  assert.equal(fresh.status, 200);
  assert.deepEqual(fresh.json, { object: 'upload_chunk', index: 0, size: 8 });
});

test('answers 409 idempotency_conflict for other parameters under the same key', async t => {
  const fake = await startApi(t);
  await createUpload(fake, 'k1');
  const other = await createUpload(fake, 'k1', { upload: { filename: 'b.mp3', size: 20, mime_type: 'audio/mpeg' } });

  assert.equal(other.status, 409);
  assert.equal(other.json.error.code, 'idempotency_conflict');
});

test('plans chunks of chunkSize and gives a path-only chunk url under the prefix', async t => {
  const fake = await startApi(t, { prefix: '/mock-api', chunkSize: 8 });
  const created = await createUpload(fake, 'k1');

  assert.equal(fake.url.endsWith('/mock-api'), true);
  const template = `/mock-api/v1/transcriptions/${created.json.id}/upload/chunks/{index}`;
  assert.equal(created.json.upload.chunk_url_template, template);
  assert.deepEqual(created.json.upload.chunks, [
    { index: 0, offset: 0, size: 8 },
    { index: 1, offset: 8, size: 8 },
    { index: 2, offset: 16, size: 4 },
  ]);
  assert.match(created.json.upload.expires_at, /^\d{4}-\d\d-\d\dT/);
});

test('routes only under the prefix', async t => {
  const fake = await startApi(t, { prefix: '/mock-api' });
  const { origin } = new URL(fake.url);
  const bare = await fetch(`${origin}/v1/account`, { headers: { Authorization: 'Bearer t1_test' } });
  const prefixed = await callApi(fake, 'GET', '/v1/account');

  assert.equal(bare.status, 404);
  assert.equal(prefixed.status, 200);
  assert.deepEqual(fake.log, ['GET /v1/account', 'GET /mock-api/v1/account']);
});

test('stores chunks in order and completes the upload', async t => {
  const fake = await startApi(t);
  const created = await createUpload(fake, 'k1');
  await putChunk(fake, created, 1, '89abcdef');
  await putChunk(fake, created, 0, '01234567');
  await putChunk(fake, created, 2, 'ghij');
  const done = await callApi(fake, 'POST', `/v1/transcriptions/${created.json.id}/upload/complete`);

  assert.equal(done.status, 202);
  assert.equal(done.json.status, 'queued');
  assert.equal(new TextDecoder().decode(fake.uploaded(created.json.id)), '0123456789abcdefghij');
  assert.deepEqual(fake.log.slice(1, 4), ['PUT chunk 1', 'PUT chunk 0', 'PUT chunk 2']);
});

test('answers 409 upload_incomplete with the missing chunks', async t => {
  const fake = await startApi(t);
  const created = await createUpload(fake, 'k1');
  await putChunk(fake, created, 0, '01234567');
  const done = await callApi(fake, 'POST', `/v1/transcriptions/${created.json.id}/upload/complete`);

  assert.equal(done.status, 409);
  assert.equal(done.json.error.code, 'upload_incomplete');
  assert.deepEqual(done.json.error.missing_chunks, [1, 2]);
});

test('forgets the completeMissing chunks on the first complete only', async t => {
  const fake = await startApi(t, { completeMissing: [1] });
  const created = await createUpload(fake, 'k1');
  for (const [index, bytes] of ['01234567', '89abcdef', 'ghij'].entries()) {
    await putChunk(fake, created, index, bytes);
  }

  const first = await callApi(fake, 'POST', `/v1/transcriptions/${created.json.id}/upload/complete`);
  await putChunk(fake, created, 1, '89abcdef');
  const second = await callApi(fake, 'POST', `/v1/transcriptions/${created.json.id}/upload/complete`);

  assert.equal(first.status, 409);
  assert.deepEqual(first.json.error.missing_chunks, [1]);
  assert.equal(second.status, 202);
});

test('answers scripted chunk statuses before normal answers', async t => {
  const fake = await startApi(t, { chunkStatus: { 0: [503, 401] } });
  const created = await createUpload(fake, 'k1');
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const reply = await putChunk(fake, created, 0, '01234567');
    statuses.push(reply.status);
  }

  assert.deepEqual(statuses, [503, 401, 200]);
});

const createLink = async (fake: FakeApiType, extra: Record<string, unknown> = {}, query = '') => callApi(fake, 'POST', `/v1/transcriptions${query}`, {
  body: { ...link, ...extra },
});

test('completes a job after the configured number of polls', async t => {
  const fake = await startApi(t, { polls: 3 });
  const created = await createLink(fake);
  const statuses: string[] = [];
  for (let poll = 0; poll < 3; poll++) {
    statuses.push((await callApi(fake, 'GET', `/v1/transcriptions/${created.json.id}?wait=60`)).json.status);
  }

  assert.equal(created.status, 202);
  assert.deepEqual(statuses, ['transcribing', 'transcribing', 'completed']);
});

test('returns the transcript and the title of a completed job', async t => {
  const fake = await startApi(t, { titles: { dQw4w9WgXcQ: 'Never Gonna' } });
  const created = await createLink(fake);
  const done = await callApi(fake, 'GET', `/v1/transcriptions/${created.json.id}`);

  assert.equal(done.status, 200);
  assert.equal(done.json.media.title, 'Never Gonna');
  assert.equal(done.json.source.media_id, 'dQw4w9WgXcQ');
  assert.equal(done.json.billed_minutes, 1);
  assert.equal(done.json.transcript.segments.length, 2);
  assert.equal(done.json.transcript.text, 'Welcome to the show. Thanks for having me.');
});

test('fails a job with failCode and refunds its minutes', async t => {
  const fake = await startApi(t, { failCode: 'media_private', minutesLeft: 5 });
  const created = await createLink(fake);
  const failed = await callApi(fake, 'GET', `/v1/transcriptions/${created.json.id}`);
  const account = await callApi(fake, 'GET', '/v1/account');

  assert.equal(failed.json.status, 'failed');
  assert.equal(failed.json.error.code, 'media_private');
  assert.equal(failed.json.transcript, undefined);
  assert.equal(account.json.minutes.remaining, 5);
});

test('reuses a recent job with reused true when asked', async t => {
  const fake = await startApi(t);
  const first = await createLink(fake);
  const reused = await createLink(fake, {}, '?reuse_recent=true');
  const fresh = await createLink(fake);

  assert.equal(first.json.reused, false);
  assert.equal(reused.json.id, first.json.id);
  assert.equal(reused.json.reused, true);
  assert.notEqual(fresh.json.id, first.json.id);
});

test('renders text, srt and vtt', async t => {
  const fake = await startApi(t);
  const created = await createLink(fake, { diarize: true });
  const { id } = created.json;
  const text = await callApi(fake, 'GET', `/v1/transcriptions/${id}?format=text&timestamps=true`);
  const srt = await callApi(fake, 'GET', `/v1/transcriptions/${id}?format=srt`);
  const vtt = await callApi(fake, 'GET', `/v1/transcriptions/${id}?format=vtt`);

  assert.equal(text.text, '[00:00:00] Speaker 1: Welcome to the show.\n[00:00:03] Speaker 2: Thanks for having me.\n');
  assert.match(text.headers.get('content-type') ?? '', /^text\/plain/);
  assert.equal(
    srt.text,
    '1\n00:00:00,000 --> 00:00:03,200\nSpeaker 1: Welcome to the show.\n\n'
    + '2\n00:00:03,200 --> 00:00:07,500\nSpeaker 2: Thanks for having me.\n',
  );
  assert.match(srt.headers.get('content-type') ?? '', /^application\/x-subrip/);
  assert.equal(
    vtt.text,
    'WEBVTT\n\n00:00:00.000 --> 00:00:03.200\n<v Speaker 1>Welcome to the show.\n\n'
    + '00:00:03.200 --> 00:00:07.500\n<v Speaker 2>Thanks for having me.\n',
  );
  assert.match(vtt.headers.get('content-type') ?? '', /^text\/vtt/);
});

test('answers a rendered format with 202 JSON while the job runs', async t => {
  const fake = await startApi(t, { polls: 2 });
  const created = await createLink(fake);
  const running = await callApi(fake, 'GET', `/v1/transcriptions/${created.json.id}?format=text`);

  assert.equal(running.status, 202);
  assert.equal(running.json.status, 'transcribing');
});

test('answers the pollErrors statuses first, one per poll', async t => {
  const fake = await startApi(t, { pollErrors: [503, 429] });
  const created = await createLink(fake);
  const path = `/v1/transcriptions/${created.json.id}`;
  const first = await callApi(fake, 'GET', path);
  const second = await callApi(fake, 'GET', path);
  const third = await callApi(fake, 'GET', path);

  assert.equal(first.status, 503);
  assert.equal(first.json.error.code, 'service_unavailable');
  assert.equal(first.json.error.retryable, true);
  assert.equal(second.status, 429);
  assert.equal(second.headers.get('retry-after'), '1');
  assert.equal(third.json.status, 'completed');
});

test('destroys the socket on the next dropPolls polls', async t => {
  const fake = await startApi(t, { dropPolls: 1 });
  const created = await createLink(fake);
  const path = `/v1/transcriptions/${created.json.id}`;

  await assert.rejects(callApi(fake, 'GET', path));
  assert.equal((await callApi(fake, 'GET', path)).json.status, 'completed');
});

test('lists newest first with an opaque cursor and a null cursor on the last page', async t => {
  const fake = await startApi(t, { pageSize: 2 });
  const ids: string[] = [];
  for (let n = 0; n < 5; n++) {
    ids.push((await createLink(fake, { url: `https://youtu.be/video${n}aaaaa` })).json.id);
  }

  const first = await callApi(fake, 'GET', '/v1/transcriptions');
  const second = await callApi(fake, 'GET', `/v1/transcriptions?cursor=${first.json.next_cursor}`);
  const third = await callApi(fake, 'GET', `/v1/transcriptions?cursor=${second.json.next_cursor}&limit=10`);

  assert.equal(first.json.object, 'list');
  assert.deepEqual(first.json.data.map((item: any) => item.id), [ids[4], ids[3]]);
  assert.deepEqual(second.json.data.map((item: any) => item.id), [ids[2], ids[1]]);
  assert.deepEqual(third.json.data.map((item: any) => item.id), [ids[0]]);
  assert.equal(third.json.next_cursor, null);
  assert.equal(typeof first.json.next_cursor, 'string');
  assert.equal(first.json.data[0].transcript, undefined);
});

test('filters the list by status and rejects a bad cursor', async t => {
  const fake = await startApi(t);
  const done = await createLink(fake);
  await callApi(fake, 'GET', `/v1/transcriptions/${done.json.id}`);
  await createUpload(fake, 'k1');

  const completed = await callApi(fake, 'GET', '/v1/transcriptions?status=completed');
  const awaiting = await callApi(fake, 'GET', '/v1/transcriptions?status=awaiting_upload&platform=upload');
  const bad = await callApi(fake, 'GET', '/v1/transcriptions?cursor=nope');

  assert.deepEqual(completed.json.data.map((item: any) => item.id), [done.json.id]);
  assert.equal(awaiting.json.data.length, 1);
  assert.equal(bad.status, 422);
  assert.equal(bad.json.error.code, 'invalid_request');
});

test('cancels a running job and deletes a finished one', async t => {
  const fake = await startApi(t, { polls: 2, minutesLeft: 5 });
  const running = await createLink(fake);
  const canceled = await callApi(fake, 'DELETE', `/v1/transcriptions/${running.json.id}`);
  const afterCancel = await callApi(fake, 'GET', `/v1/transcriptions/${running.json.id}`);
  const account = await callApi(fake, 'GET', '/v1/account');
  const removed = await callApi(fake, 'DELETE', `/v1/transcriptions/${running.json.id}`);
  const gone = await callApi(fake, 'GET', `/v1/transcriptions/${running.json.id}`);

  assert.equal(canceled.status, 204);
  assert.equal(afterCancel.json.status, 'canceled');
  assert.equal(account.json.minutes.remaining, 5);
  assert.equal(removed.status, 204);
  assert.equal(gone.status, 404);
});

test('creates link jobs without a platform and reports the detected one', async t => {
  const fake = await startApi(t);
  const youtube = await callApi(fake, 'POST', '/v1/transcriptions', { body: { url: link.url } });
  const x = await callApi(fake, 'POST', '/v1/transcriptions', { body: { url: 'https://x.com/jack/status/20' } });
  const mismatch = await createLink(fake, { platform: 'tiktok', url: 'https://x.com/jack/status/20' });

  assert.equal(youtube.json.source.platform, 'youtube');
  assert.equal(x.json.source.platform, 'x');
  assert.equal(x.json.source.url, 'https://x.com/jack/status/20');
  assert.equal(x.json.source.media_id, null);
  assert.deepEqual([mismatch.status, mismatch.json.error.code], [422, 'invalid_url']);
});

test('refuses bad create bodies with the envelope', async t => {
  const fake = await startApi(t);
  const platform = await createLink(fake, { platform: 'vimeo' });
  const url = await createLink(fake, { url: 'https://example.com/x' });
  const extension = await createUpload(fake, 'k1', { upload: { filename: 'a.exe', size: 5 } });
  const big = await createUpload(fake, 'k2', { upload: { filename: 'a.mp3', size: 2_000_000_001 } });
  const empty = await createUpload(fake, 'k3', { upload: { filename: 'a.mp3', size: 0 } });

  assert.deepEqual([platform.status, platform.json.error.code], [422, 'unsupported_platform']);
  assert.deepEqual(platform.json.error.supported_platforms, ['youtube', 'x', 'tiktok', 'instagram', 'facebook', 'bluesky']);
  assert.deepEqual([url.status, url.json.error.code], [422, 'invalid_url']);
  assert.deepEqual([extension.status, extension.json.error.code], [422, 'unsupported_media']);
  assert.deepEqual([big.status, big.json.error.code], [413, 'media_too_large']);
  assert.equal(big.json.error.max_bytes, 2_000_000_000);
  assert.deepEqual([empty.status, empty.json.error.code], [422, 'invalid_request']);
});

test('refuses reuse_recent on an upload create like the api', async t => {
  const fake = await startApi(t);
  const reply = await callApi(fake, 'POST', '/v1/transcriptions?reuse_recent=true', {
    headers: { 'Idempotency-Key': 'k1' },
    body: uploadBody,
  });

  assert.deepEqual([reply.status, reply.json.error.code], [422, 'invalid_request']);
  assert.equal(reply.json.error.message, 'reuse_recent is available only for platform URLs');
});

const createGate = (): { promise: Promise<void>; open: () => void } => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });

  return { promise, open };
};

test('holds chunk puts on blockChunks, counts the peak and releases them on close', async () => {
  const fake = await startFakeApi({ blockChunks: createGate().promise });
  const created = await createUpload(fake, 'k1');
  const pending = [0, 1].map(async index => putChunk(fake, created, index, '01234567').catch(() => null));
  await new Promise(resolve => {
    setTimeout(resolve, 100);
  });

  assert.equal(fake.peakChunks(), 2);
  await fake.close();
  await Promise.all(pending);
});

test('releases blocked chunk puts when the promise resolves', async t => {
  const { promise, open } = createGate();
  const fake = await startApi(t, { blockChunks: promise });
  const created = await createUpload(fake, 'k1');
  const put = putChunk(fake, created, 0, '01234567');
  open();
  const reply = await put;

  assert.equal(reply.status, 200);
});
