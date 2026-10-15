import type { ConfigType } from '../config.js';
import { classify } from '../inputs/classify.js';
import type { FileInputType } from '../inputs/types.js';
import type { CreateOptions, Input, Transcription } from '../types.js';
import type { CreateBodyType } from '../uploads/types.js';
import { uploadFile } from '../uploads/upload-file.js';
import { createLink } from './create-link.js';
import { createSlotWaiter } from './wait-slot.js';

const buildUploadBody = (file: FileInputType, options: CreateOptions): CreateBodyType => {
  const body: CreateBodyType = { upload: { filename: file.filename, size: file.size, mime_type: file.mimeType } };
  if (options.language) {
    body.language = options.language;
  }

  if (options.speakers) {
    body.diarize = true;
  }

  return body;
};

export const create = async (config: ConfigType, input: Input, options: CreateOptions = {}): Promise<Transcription> => {
  const idempotencyKey = options.idempotencyKey ?? crypto.randomUUID();
  const classified = await classify(input, { filename: options.filename, size: options.size });
  if (classified.kind === 'link') {
    return createLink(config, classified, { ...options, idempotencyKey });
  }

  return uploadFile(config, classified, {
    idempotencyKey,
    body: buildUploadBody(classified, options),
    onProgress: options.onProgress,
    signal: options.signal,
    waitSlot: createSlotWaiter(config, options.onProgress),
  });
};
