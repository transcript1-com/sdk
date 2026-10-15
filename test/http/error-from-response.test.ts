import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transcript1Error } from '../../src/errors.js';
import { errorFromResponse } from '../../src/http/error-from-response.js';

const buildEnvelope = (error: Record<string, unknown>) => JSON.stringify({ error });

test('builds the error from the envelope with the extra fields as details', () => {
  const body = buildEnvelope({
    code: 'insufficient_minutes',
    message: 'Not enough minutes',
    retryable: false,
    needed: 12,
    action_url: 'https://x.test/billing',
  });
  const error = errorFromResponse(402, new Headers(), body);
  assert.ok(error instanceof Transcript1Error);
  assert.equal(error.code, 'insufficient_minutes');
  assert.equal(error.message, 'Not enough minutes');
  assert.equal(error.status, 402);
  assert.equal(error.retryable, false);
  assert.deepEqual(error.details, { needed: 12, action_url: 'https://x.test/billing' });
});

test('takes retryable from the envelope', () => {
  const body = buildEnvelope({ code: 'service_unavailable', message: 'Try later', retryable: true });
  assert.equal(errorFromResponse(503, new Headers(), body).retryable, true);
});

test('puts Retry-After into details as seconds', () => {
  const body = buildEnvelope({ code: 'rate_limited', message: 'Slow down', retryable: true });
  const error = errorFromResponse(429, new Headers({ 'Retry-After': '7' }), body);
  assert.deepEqual(error.details, { retry_after: 7 });
});

test('lets the Retry-After header win over an envelope retry_after', () => {
  const body = buildEnvelope({ code: 'rate_limited', message: 'Slow down', retry_after: 99 });
  const error = errorFromResponse(429, new Headers({ 'Retry-After': '7' }), body);
  assert.equal(error.details.retry_after, 7);
});

test('answers a non-json body with http_<status>', () => {
  const error = errorFromResponse(502, new Headers(), '<html>Bad gateway</html>');
  assert.equal(error.code, 'http_502');
  assert.equal(error.message, 'the server answered HTTP 502');
  assert.equal(error.status, 502);
  assert.equal(error.retryable, true);
});

test('answers json without an envelope with http_<status>', () => {
  for (const body of ['{"detail":"nope"}', '{"error":"flat"}', '{"error":{"message":"no code"}}', '[]', 'null']) {
    const error = errorFromResponse(400, new Headers(), body);
    assert.equal(error.code, 'http_400');
    assert.equal(error.retryable, false);
  }
});

test('marks 429 and 5xx without an envelope as retryable only', () => {
  assert.equal(errorFromResponse(429, new Headers(), '').retryable, true);
  assert.equal(errorFromResponse(500, new Headers(), '').retryable, true);
  assert.equal(errorFromResponse(404, new Headers(), '').retryable, false);
});
