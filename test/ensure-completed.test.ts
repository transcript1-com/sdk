import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ERROR_CODES } from '../src/codes.js';
import { Transcript1Error } from '../src/errors.js';
import { ensureCompleted } from '../src/ensure-completed.js';
import type { Status, Transcription } from '../src/types.js';

const buildJob = (status: Status, error: Transcription['error'] = null): Transcription => ({
  id: 'tr_1',
  object: 'transcription',
  status,
  source: {
    platform: 'youtube',
    url: null,
    media_id: null,
  },
  media: null,
  options: {
    source: 'auto',
    language: 'auto',
    diarize: false,
  },
  transcript_source: null,
  caption_kind: null,
  language: null,
  billed_minutes: null,
  cached: false,
  error,
  created_at: null,
  completed_at: null,
});

const expectThrown = (job: Transcription): Transcript1Error => {
  try {
    ensureCompleted(job);
  } catch (error: unknown) {
    assert.ok(error instanceof Transcript1Error);

    return error;
  }

  throw new assert.AssertionError({ message: 'expected a rejection' });
};

test('returns a completed job as it is', () => {
  const job = buildJob('completed');

  assert.equal(ensureCompleted(job), job);
});

test('throws the job error code and message for a failed job', () => {
  const job = buildJob('failed', { code: 'no_speech', message: 'No speech found' });
  const error = expectThrown(job);

  assert.equal(error.code, 'no_speech');
  assert.equal(error.message, 'No speech found');
  assert.equal(error.transcriptionId, 'tr_1');
  assert.equal(error.transcription, job);
});

test('falls back to transcription_failed for a failed job without an error', () => {
  const error = expectThrown(buildJob('failed'));

  assert.equal(error.code, ERROR_CODES.transcription_failed);
  assert.equal(error.message, 'The transcription failed');
});

test('falls back to the failure message for a failed job whose error has no message', () => {
  const error = expectThrown(buildJob('failed', { code: 'fetch_failed', message: null }));

  assert.equal(error.code, 'fetch_failed');
  assert.equal(error.message, 'The transcription failed');
});

test('throws canceled for a canceled job', () => {
  const error = expectThrown(buildJob('canceled'));

  assert.equal(error.code, 'canceled');
  assert.equal(error.transcriptionId, 'tr_1');
});
