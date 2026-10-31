import { ERROR_CODES } from '../../src/codes.js';
import type { Format } from '../../src/types.js';
import {
  CONTENT_TYPES,
  render,
  serialize,
  type TranslationModeType,
} from './serialize.js';
import {
  buildRetryHeaders,
  getCodeForStatus,
  send,
  sendError,
  sendJson,
  type ContextType,
  type HandlerType,
} from './http.js';
import { advanceJob, findOwnedJob, getJobStatusCode } from './jobs.js';

const isFormat = (value: string): value is Format => ['json', 'text', 'srt', 'vtt'].includes(value);

const failPoll = (context: ContextType): boolean => {
  const { state, req, res } = context;
  if (state.knobs.dropPolls > 0) {
    state.knobs.dropPolls--;
    req.socket.destroy();
    return true;
  }

  const status = state.knobs.pollErrors.shift();
  if (status === undefined) {
    return false;
  }

  sendError(res, status, getCodeForStatus(status), `Scripted answer ${status}`, { headers: buildRetryHeaders(status) });

  return true;
};

const readMode = (value: string | null): TranslationModeType => {
  if (value === 'only' || value === 'none') {
    return value;
  }

  return 'both';
};

export const get: HandlerType = context => {
  const { state, res, query } = context;
  const job = findOwnedJob(context);
  if (!job) {
    return;
  }

  if (failPoll(context)) {
    return;
  }

  const format = query.get('format') ?? 'json';
  if (!isFormat(format)) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'format must be json, text, srt or vtt');
    return;
  }

  const mode = readMode(query.get('translation'));
  advanceJob(state, job);
  if (format === 'json') {
    sendJson(res, 200, serialize(state, job, true, mode));
    return;
  }

  if (job.status === 'completed') {
    const rendered = render(job, format, query.get('timestamps') === 'true', mode);
    send(res, 200, rendered, { 'Content-Type': CONTENT_TYPES[format] });
    return;
  }

  sendJson(res, getJobStatusCode(job), serialize(state, job, true, mode));
};
