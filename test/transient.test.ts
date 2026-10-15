import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Transcript1Error } from '../src/errors.js';
import { isTransient } from '../src/transient.js';

const buildError = (code: string, status?: number) => new Transcript1Error(code, code, { status });

test('counts network errors, 429 and the 5xx gateway answers as transient', () => {
  assert.equal(isTransient(buildError('network_error')), true);
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(isTransient(buildError('anything', status)), true, String(status));
  }
});

test('counts other answers, aborts and foreign errors as final', () => {
  for (const status of [400, 401, 403, 404, 409, 422, 501]) {
    assert.equal(isTransient(buildError('anything', status)), false, String(status));
  }

  assert.equal(isTransient(buildError('aborted')), false);
  assert.equal(isTransient(new Error('boom')), false);
});
