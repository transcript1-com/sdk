import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MAX_RETRY_AFTER_MS, retryAfterMs, retryDelayMs } from '../../src/http/retry.js';

test('reads Retry-After in seconds', () => {
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': '7' })), 7000);
});

test('reads Retry-After as an http date', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-16T10:00:00Z') });
  const headers = new Headers({ 'Retry-After': 'Fri, 16 Oct 2026 10:00:12 GMT' });
  assert.equal(retryAfterMs(headers), 12_000);
});

test('treats a missing, zero, past or garbled Retry-After as absent', t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-16T10:00:00Z') });
  assert.equal(retryAfterMs(new Headers()), undefined);
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': '0' })), undefined);
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': '-3' })), undefined);
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': 'soon' })), undefined);
  assert.equal(retryAfterMs(new Headers({ 'Retry-After': 'Fri, 16 Oct 2026 09:00:00 GMT' })), undefined);
});

test('doubles the wait per attempt and adds up to 25% jitter', () => {
  assert.equal(retryDelayMs(0, new Headers(), () => 0), 1000);
  assert.equal(retryDelayMs(1, new Headers(), () => 0), 2000);
  assert.equal(retryDelayMs(2, new Headers(), () => 0), 4000);
  assert.equal(retryDelayMs(0, new Headers(), () => 0.5), 1125);
  assert.equal(retryDelayMs(1, new Headers(), () => 0.5), 2250);
});

test('lets Retry-After replace the backoff', () => {
  assert.equal(retryDelayMs(0, new Headers({ 'Retry-After': '7' }), () => 0.9), 7000);
});

test('caps Retry-After at 60 seconds', () => {
  assert.equal(MAX_RETRY_AFTER_MS, 60_000);
  assert.equal(retryDelayMs(0, new Headers({ 'Retry-After': '3600' }), () => 0), 60_000);
});
