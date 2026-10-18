export const REQUEST_ERROR_CODES = [
  'invalid_request',
  'invalid_url',
  'unsupported_platform',
  'unsupported_media',
  'unauthorized',
  'insufficient_scope',
  'email_not_verified',
  'insufficient_minutes',
  'no_active_plan',
  'not_found',
  'upload_incomplete',
  'invalid_state',
  'idempotency_conflict',
  'media_too_large',
  'rate_limited',
  'too_many_active_jobs',
  'internal_error',
  'service_unavailable',
] as const;

export const JOB_FAILURE_CODES = [
  'media_unavailable',
  'media_private',
  'age_restricted',
  'live_stream',
  'no_captions',
  'media_too_long',
  'unsupported_media',
  'no_speech',
  'unsupported_language',
  'insufficient_minutes',
  'fetch_failed',
  'transcription_failed',
] as const;

export const LOCAL_CODES = [
  'missing_api_key',
  'invalid_input',
  'aborted',
  'network_error',
  'upload_token_refused',
] as const;

export const CANCELED_CODE = 'canceled';

export type RequestErrorCode = typeof REQUEST_ERROR_CODES[number];
export type JobFailureCode = typeof JOB_FAILURE_CODES[number];
export type LocalCode = typeof LOCAL_CODES[number];
export type ErrorCode = RequestErrorCode | JobFailureCode | LocalCode | typeof CANCELED_CODE;

const allCodes: readonly ErrorCode[] = [...REQUEST_ERROR_CODES, ...JOB_FAILURE_CODES, ...LOCAL_CODES, CANCELED_CODE];

export const ERROR_CODES = Object.fromEntries(allCodes.map(code => [code, code])) as { [Code in ErrorCode]: Code };
