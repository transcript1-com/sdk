import { ERROR_CODES } from '../../src/codes.js';
import { sendError, sendJson, type HandlerType } from './http.js';
import {
  findMissingChunks,
  findOwnedJob,
  refuseStart,
  startJob,
} from './jobs.js';
import { serialize } from './serialize.js';

export const complete: HandlerType = context => {
  const { state, res } = context;
  const job = findOwnedJob(context);
  if (!job) {
    return;
  }

  if (job.status !== 'awaiting_upload') {
    sendError(res, 409, ERROR_CODES.invalid_state, 'Transcription is not awaiting an upload');
    return;
  }

  state.completes++;
  if (state.completes === 1) {
    for (const index of state.knobs.completeMissing) {
      job.received.delete(index);
    }
  }

  const missing = findMissingChunks(job);
  if (missing.length > 0) {
    sendError(res, 409, ERROR_CODES.upload_incomplete, 'Missing chunks', { extra: { missing_chunks: missing } });
    return;
  }

  if (refuseStart(state, res)) {
    return;
  }

  startJob(state, job);
  sendJson(res, 202, serialize(state, job, false));
};
