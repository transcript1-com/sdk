import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import { isSlotBusy } from '../slot-busy.js';
import type { Transcription } from '../types.js';
import type { UploadOptionsType } from './types.js';
import { buildAbortedUploadError } from './with-job-id.js';

export const createUpload = async (config: ConfigType, options: UploadOptionsType, signal?: AbortSignal): Promise<Transcription> => {
  const created = await request(config, {
    method: 'POST',
    path: '/v1/transcriptions',
    body: options.body,
    headers: { 'Idempotency-Key': options.idempotencyKey },
    signal,
  });

  return created.json as Transcription;
};

export const openUpload = async (config: ConfigType, options: UploadOptionsType, signal?: AbortSignal): Promise<Transcription> => {
  try {
    const created = await request(config, {
      method: 'POST',
      path: '/v1/transcriptions',
      body: options.body,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      signal,
      retry429: false,
    });

    return created.json as Transcription;
  } catch (error: unknown) {
    if (!isSlotBusy(error)) {
      throw error;
    }

    await options.waitSlot(error, signal);
    if (signal?.aborted) {
      throw buildAbortedUploadError();
    }

    return openUpload(config, options, signal);
  }
};
