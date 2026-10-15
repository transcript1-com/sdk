import { ERROR_CODES } from '../../src/codes.js';
import {
  buildRetryHeaders,
  getCodeForStatus,
  sendError,
  sendJson,
  type ContextType,
  type HandlerType,
} from './http.js';
import { findOwnedJob } from './jobs.js';
import type { JobType } from './state.js';

const UPLOAD_TTL_MS = 60 * 60 * 1000;

const holdChunk = async (context: ContextType): Promise<boolean> => {
  const { state, res } = context;
  const { blockChunks } = state.knobs;
  if (!blockChunks) {
    return true;
  }

  const gone = new Promise<boolean>(resolve => {
    res.once('close', () => {
      resolve(false);
    });
  });
  const closing = state.closing.then(() => false);

  return Promise.race([blockChunks.then(() => true), closing, gone]);
};

const sendScriptedAnswer = (context: ContextType, index: number): boolean => {
  const { state, res } = context;
  const calls = state.chunkCalls.get(index) ?? 0;
  state.chunkCalls.set(index, calls + 1);
  const status = state.knobs.chunkStatus[index]?.[calls];
  if (status === undefined) {
    return false;
  }

  sendError(res, status, getCodeForStatus(status), `Scripted answer ${status}`, { headers: buildRetryHeaders(status) });

  return true;
};

const parseIndex = (value: string | undefined): number => {
  if (!/^\d+$/.test(value ?? '')) {
    return -1;
  }

  return Number(value);
};

const sendTokenError = (context: ContextType, job: JobType) => {
  const { res } = context;
  if (job.status !== 'awaiting_upload' && !job.token) {
    sendError(res, 409, ERROR_CODES.invalid_state, 'Transcription is not awaiting an upload');
    return;
  }

  sendError(res, 401, ERROR_CODES.unauthorized, 'Invalid or expired upload token');
};

const storeChunk = async (context: ContextType) => {
  const { state, req, res, params } = context;
  const bytes = await context.body();
  const index = parseIndex(params.index);
  if (sendScriptedAnswer(context, index)) {
    return;
  }

  const job = state.jobs.get(params.id ?? '');
  if (!job) {
    sendError(res, 404, ERROR_CODES.not_found, 'Transcription not found');
    return;
  }

  const token = req.headers['x-upload-token'];
  if (!token) {
    sendTokenError(context, job);
    return;
  }

  if (token !== job.token) {
    sendTokenError(context, job);
    return;
  }

  if (job.status !== 'awaiting_upload') {
    sendError(res, 409, ERROR_CODES.invalid_state, 'Transcription is not awaiting an upload');
    return;
  }

  const chunk = job.chunks[index];
  if (!chunk) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'Chunk is outside the plan or has the wrong size');
    return;
  }

  if (chunk.size !== bytes.length) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'Chunk is outside the plan or has the wrong size');
    return;
  }

  const data = job.data ?? new Uint8Array(job.size);
  data.set(bytes, chunk.offset);
  job.data = data;
  job.received.add(index);
  sendJson(res, 200, {
    object: 'upload_chunk',
    index,
    size: bytes.length,
  });
};

export const putChunk: HandlerType = async context => {
  const { state } = context;
  state.inFlight++;
  state.peakChunks = Math.max(state.peakChunks, state.inFlight);
  try {
    if (!await holdChunk(context)) {
      return;
    }

    await storeChunk(context);
  } finally {
    state.inFlight--;
  }
};

const countUploadedBytes = (job: JobType): number => {
  let total = 0;
  for (const chunk of job.chunks) {
    if (!job.received.has(chunk.index)) {
      continue;
    }

    total += chunk.size;
  }

  return total;
};

const getExpiresAt = (job: JobType): string | null => {
  if (!job.token) {
    return null;
  }

  return new Date(Date.now() + UPLOAD_TTL_MS).toISOString();
};

export const getProgress: HandlerType = context => {
  const { res } = context;
  const job = findOwnedJob(context);
  if (!job) {
    return;
  }

  if (job.platform !== 'upload') {
    sendError(res, 404, ERROR_CODES.not_found, 'Upload not found');
    return;
  }

  sendJson(res, 200, {
    object: 'upload',
    status: job.status,
    total_bytes: job.size,
    uploaded_bytes: countUploadedBytes(job),
    received_chunks: [...job.received].sort((a, b) => a - b),
    chunks: job.chunks,
    expires_at: getExpiresAt(job),
  });
};
