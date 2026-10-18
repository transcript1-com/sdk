import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transcript1Error } from '../src/errors.js';
import {
  ERROR_CODES,
  JOB_FAILURE_CODES,
  LOCAL_CODES,
  REQUEST_ERROR_CODES,
} from '../src/codes.js';
import type { Transcription } from '../src/types.js';

test('builds an error with only a code and a message', () => {
  const error = new Transcript1Error('not_found', 'No such transcription');

  assert.equal(error.code, 'not_found');
  assert.equal(error.message, 'No such transcription');
  assert.equal(error.name, 'Transcript1Error');
  assert.equal(error.status, undefined);
  assert.deepEqual(error.details, {});
  assert.equal(error.retryable, false);
  assert.equal(error.transcriptionId, undefined);
  assert.equal(error.transcription, undefined);
});

test('is an Error and a Transcript1Error', () => {
  const error = new Transcript1Error('internal_error', 'Boom');

  assert.ok(error instanceof Error);
  assert.ok(error instanceof Transcript1Error);
  assert.ok(error.stack?.includes('Boom'));
});

test('keeps the extra fields it is given', () => {
  const transcription: Transcription = {
    id: 'tr_1',
    object: 'transcription',
    status: 'failed',
    source: { platform: 'upload', filename: 'talk.mp3', size: 10 },
    media: null,
    options: { source: 'auto', language: 'auto', diarize: false },
    transcript_source: null,
    caption_kind: null,
    language: null,
    billed_minutes: null,
    cached: false,
    error: { code: 'insufficient_minutes', message: null },
    created_at: null,
    completed_at: null,
  };
  const error = new Transcript1Error('insufficient_minutes', 'Need more minutes', {
    status: 402,
    details: { minutes_needed: 20, action_url: 'https://transcript1.com/dashboard/billing' },
    retryable: false,
    transcriptionId: 'tr_1',
    transcription,
  });

  assert.equal(error.status, 402);
  assert.deepEqual(error.details, { minutes_needed: 20, action_url: 'https://transcript1.com/dashboard/billing' });
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(error.transcription, transcription);
});

test('marks a rate limit answer as retryable', () => {
  const error = new Transcript1Error('rate_limited', 'Slow down', { status: 429, retryable: true });

  assert.equal(error.retryable, true);
});

test('lists every request error code of the API', () => {
  assert.deepEqual([...REQUEST_ERROR_CODES].sort(), [
    'email_not_verified',
    'idempotency_conflict',
    'insufficient_minutes',
    'insufficient_scope',
    'internal_error',
    'invalid_request',
    'invalid_state',
    'invalid_url',
    'media_too_large',
    'no_active_plan',
    'not_found',
    'rate_limited',
    'service_unavailable',
    'too_many_active_jobs',
    'unauthorized',
    'unsupported_media',
    'unsupported_platform',
    'upload_incomplete',
  ]);
});

test('lists every job failure code and the local codes', () => {
  assert.deepEqual([...JOB_FAILURE_CODES].sort(), [
    'age_restricted',
    'fetch_failed',
    'insufficient_minutes',
    'live_stream',
    'login_required',
    'media_private',
    'media_too_long',
    'media_unavailable',
    'no_audio',
    'no_captions',
    'no_speech',
    'transcription_failed',
    'unsupported_language',
    'unsupported_media',
  ]);
  assert.deepEqual([...LOCAL_CODES].sort(), [
    'aborted',
    'invalid_input',
    'missing_api_key',
    'network_error',
    'upload_token_refused',
  ]);
});

test('names each code as a constant with the same value', () => {
  assert.equal(ERROR_CODES.missing_api_key, 'missing_api_key');
  assert.equal(ERROR_CODES.too_many_active_jobs, 'too_many_active_jobs');
  assert.equal(ERROR_CODES.media_private, 'media_private');
  assert.equal(ERROR_CODES.canceled, 'canceled');
});
