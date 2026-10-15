import { ERROR_CODES } from '../codes.js';
import { Transcript1Error } from '../errors.js';
import { request } from '../http/request.js';
import type { Chunk, Transcription } from '../types.js';
import { sendChunks } from './send-chunks.js';
import type { UploadType } from './types.js';

const isSlotBusy = (error: unknown): error is Transcript1Error => {
  if (!(error instanceof Transcript1Error)) {
    return false;
  }

  if (error.status !== 429) {
    return false;
  }

  if (error.code === ERROR_CODES.too_many_active_jobs) {
    return true;
  }

  return error.code === ERROR_CODES.rate_limited;
};

// a job slot 429 retries only the complete, not the chunks
const sendComplete = async (upload: UploadType, signal?: AbortSignal): Promise<Transcription> => {
  const path = `/v1/transcriptions/${encodeURIComponent(upload.id)}/upload/complete`;
  try {
    const done = await request(upload.config, {
      method: 'POST',
      path,
      retry429: false,
      signal,
    });

    return done.json as Transcription;
  } catch (error: unknown) {
    if (!isSlotBusy(error)) {
      throw error;
    }

    await upload.options.waitSlot(error, signal);

    return sendComplete(upload, signal);
  }
};

const findMissingChunks = (upload: UploadType, error: Transcript1Error): Chunk[] => {
  const missing = error.details.missing_chunks;
  if (!Array.isArray(missing)) {
    throw error;
  }

  if (missing.length === 0) {
    throw error;
  }

  return missing.map(index => {
    const chunk = upload.chunks.find(planned => planned.index === index);
    if (!chunk) {
      throw error;
    }

    return chunk;
  });
};

const isIncomplete = (error: unknown): error is Transcript1Error => {
  if (!(error instanceof Transcript1Error)) {
    return false;
  }

  return error.code === ERROR_CODES.upload_incomplete;
};

// resend missing chunks once, a stream can't reread them
export const complete = async (upload: UploadType, signal?: AbortSignal): Promise<Transcription> => {
  try {
    return await sendComplete(upload, signal);
  } catch (error: unknown) {
    if (!isIncomplete(error)) {
      throw error;
    }

    if (upload.source.sequential) {
      throw error;
    }

    const chunks = findMissingChunks(upload, error);
    for (const chunk of chunks) {
      upload.received.delete(chunk.index);
    }

    await sendChunks(upload, chunks, signal);

    return sendComplete(upload, signal);
  }
};
