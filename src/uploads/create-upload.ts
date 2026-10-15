import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import type { Transcription } from '../types.js';
import type { UploadOptionsType } from './types.js';

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
