import { ERROR_CODES } from '../../src/codes.js';
import {
  parseJson,
  sendError,
  sendJson,
  type HandlerType,
} from './http.js';
import { advanceJob, findOwnedJob } from './jobs.js';

export const translations: HandlerType = async context => {
  const { state, res } = context;
  const job = findOwnedJob(context);
  if (!job) {
    return;
  }

  const raw = await parseJson(context);
  const language = raw?.language;
  if (typeof language !== 'string' || !/^[a-z]{2}$/.test(language)) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'language must be an ISO 639-1 code');
    return;
  }

  advanceJob(state, job);
  if (job.status !== 'completed') {
    sendError(res, 409, ERROR_CODES.transcript_not_ready, 'The transcript is not ready');
    return;
  }

  job.translated = [...job.translated ?? [], language];
  sendJson(res, 200, { transcription_id: job.id, language, status: 'completed' });
};
