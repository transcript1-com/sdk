import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uploadFile } from '../../src/uploads/upload-file.js';
import type { KnobsType } from '../fake-api/server.js';
import { expectRejection } from '../http/helpers.js';
import {
  buildBytes,
  buildFile,
  buildOptions,
  countRequests,
  createUploadConfig,
  startApi,
} from './helpers.js';

const DELETE_JOB = /^\/v1\/transcriptions\/tr_1$/;

type CaseType = {
  name: string;
  knobs: Partial<KnobsType>;
  kind: 'bytes' | 'stream';
  code: string;
};

const cases: CaseType[] = [
  {
    name: 'a chunk refused with 400',
    knobs: { chunkStatus: { 0: [400] } },
    kind: 'bytes',
    code: 'invalid_request',
  },
  {
    name: 'upload_token_refused',
    knobs: { chunkStatus: { 0: [401, 401, 401] } },
    kind: 'bytes',
    code: 'upload_token_refused',
  },
  {
    name: 'upload_incomplete on a stream',
    knobs: { completeMissing: [1] },
    kind: 'stream',
    code: 'upload_incomplete',
  },
];

for (const { name, knobs, kind, code } of cases) {
  test(`deletes the open upload after ${name} and keeps the error`, async t => {
    const fake = await startApi(t, knobs);
    const { config } = createUploadConfig(fake);
    const file = buildFile(buildBytes(30), kind);
    const error = await expectRejection(uploadFile(config, file, buildOptions(file)));

    assert.equal(error.code, code);
    assert.equal(error.transcriptionId, 'tr_1');
    assert.equal(countRequests(fake, 'DELETE', DELETE_JOB), 1);
  });
}
