import { ERROR_CODES } from '../codes.js';
import { Transcript1Error } from '../errors.js';
import { request } from '../http/request.js';
import { createUpload } from './create-upload.js';
import { markReceived } from './mark-received.js';
import type { UploadType } from './types.js';

type RenewedType = {
  token: string;
  received: number[];
};

const readReceived = (json: unknown): number[] => {
  const received = (json as { received_chunks?: unknown }).received_chunks;
  if (!Array.isArray(received)) {
    return [];
  }

  return received.filter(index => typeof index === 'number');
};

const fetchToken = async (upload: UploadType, signal: AbortSignal): Promise<RenewedType> => {
  const recreated = await createUpload(upload.config, upload.options, signal);
  const message = `The transcription is ${recreated.status}, not awaiting an upload`;
  if (recreated.status !== 'awaiting_upload') {
    throw new Transcript1Error(ERROR_CODES.invalid_state, message);
  }

  if (!recreated.upload) {
    throw new Transcript1Error(ERROR_CODES.invalid_state, message);
  }

  const path = `/v1/transcriptions/${encodeURIComponent(upload.id)}/upload`;
  const progress = await request(upload.config, { method: 'GET', path, signal });

  return {
    token: recreated.upload.headers['X-Upload-Token'],
    received: readReceived(progress.json),
  };
};

// first refused worker renews, the others retry with it
export const renewToken = async (upload: UploadType, generation: number, signal: AbortSignal): Promise<boolean> => {
  if (upload.generation !== generation) {
    return false;
  }

  if (upload.renewing) {
    await upload.renewing;
    return false;
  }

  let done: () => void = () => undefined;
  upload.renewing = new Promise(resolve => {
    done = resolve;
  });
  try {
    const renewed = await fetchToken(upload, signal);
    upload.token = renewed.token;
    upload.generation++;
    for (const index of renewed.received) {
      markReceived(upload, index);
    }

    return true;
  } finally {
    upload.renewing = undefined;
    done();
  }
};
