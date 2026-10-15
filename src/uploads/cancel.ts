import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import type { Transcription } from '../types.js';

const CANCEL_TIMEOUT_MS = 5000;

// only an awaiting job is deleted, nothing was charged yet
export const cancelUpload = async (config: ConfigType, id: string): Promise<'deleted' | 'running'> => {
  const signal = AbortSignal.timeout(CANCEL_TIMEOUT_MS);
  const path = `/v1/transcriptions/${encodeURIComponent(id)}`;
  const current = await request(config, { method: 'GET', path, signal });
  if ((current.json as Transcription).status !== 'awaiting_upload') {
    return 'running';
  }

  await request(config, { method: 'DELETE', path, signal });

  return 'deleted';
};
