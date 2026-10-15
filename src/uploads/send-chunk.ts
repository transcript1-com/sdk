import { ERROR_CODES } from '../codes.js';
import { Transcript1Error } from '../errors.js';
import { request } from '../http/request.js';
import { TOKEN_RENEWALS_PER_CHUNK } from '../limits.js';
import type { Chunk } from '../types.js';
import { markReceived } from './mark-received.js';
import { renewToken } from './renew-token.js';
import type { UploadType } from './types.js';

// a refused chunk token is not a bad api key
const buildTokenRefusedError = () => new Transcript1Error(
  ERROR_CODES.upload_token_refused,
  `The upload token was refused after renewing it ${TOKEN_RENEWALS_PER_CHUNK} times`,
  { status: 401 },
);

const isRefused = (error: unknown): boolean => {
  if (!(error instanceof Transcript1Error)) {
    return false;
  }

  return error.status === 401;
};

export const sendChunk = async (upload: UploadType, chunk: Chunk, data: Uint8Array, signal: AbortSignal): Promise<void> => {
  const path = upload.template.replace('{index}', String(chunk.index));
  let renewals = 0;
  while (!upload.received.has(chunk.index)) {
    const { token, generation } = upload;
    try {
      // eslint-disable-next-line no-await-in-loop
      await request(upload.config, {
        method: 'PUT',
        path,
        body: data,
        headers: { 'X-Upload-Token': token },
        auth: false,
        signal,
      });
      markReceived(upload, chunk.index);
      return;
    } catch (error: unknown) {
      if (!isRefused(error)) {
        throw error;
      }

      if (renewals === TOKEN_RENEWALS_PER_CHUNK) {
        throw buildTokenRefusedError();
      }

      // eslint-disable-next-line no-await-in-loop
      if (await renewToken(upload, generation, signal)) {
        renewals++;
      }
    }
  }
};
