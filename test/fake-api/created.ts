import type { ServerResponse } from 'node:http';
import { ERROR_CODES } from '../../src/codes.js';
import { sendError, sendJson } from './http.js';
import { findByKey, getJobStatusCode, issueToken } from './jobs.js';
import { serialize } from './serialize.js';
import type { JobType, StateType } from './state.js';

const UPLOAD_TTL_MS = 60 * 60 * 1000;

export type CreateBodyType = {
  platform?: unknown;
  url?: unknown;
  source: string;
  language: string;
  diarize: boolean;
  upload?: Record<string, unknown> | undefined;
};

export const writeCreated = (state: StateType, res: ServerResponse, job: JobType, reused: boolean) => {
  const body: Record<string, unknown> = { ...serialize(state, job, false), reused };
  if (job.status !== 'awaiting_upload') {
    sendJson(res, getJobStatusCode(job), body);
    return;
  }

  body.upload = {
    chunk_url_template: `${state.knobs.prefix}/v1/transcriptions/${job.id}/upload/chunks/{index}`,
    headers: { 'X-Upload-Token': job.token },
    expires_at: new Date(Date.now() + UPLOAD_TTL_MS).toISOString(),
    chunks: job.chunks,
  };
  sendJson(res, 201, body);
};

export const replay = (state: StateType, res: ServerResponse, key: string | undefined, params: string): boolean => {
  const job = findByKey(state, key);
  if (!job) {
    return false;
  }

  if (job.params !== params) {
    const message = 'Idempotency-Key was reused with different parameters';
    sendError(res, 409, ERROR_CODES.idempotency_conflict, message);
    return true;
  }

  if (job.status === 'awaiting_upload') {
    issueToken(state, job);
  }

  writeCreated(state, res, job, false);

  return true;
};
