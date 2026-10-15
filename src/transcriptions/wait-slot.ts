import type { ConfigType } from '../config.js';
import type { Transcript1Error } from '../errors.js';
import type { ProgressEvent } from '../types.js';

const DEFAULT_SLOT_WAIT_SECONDS = 10;

export type WaitSlotType = (error: Transcript1Error, signal?: AbortSignal) => Promise<void>;

const getSlotWaitSeconds = (error: Transcript1Error): number => {
  const seconds = error.details.retry_after;
  if (typeof seconds !== 'number') {
    return DEFAULT_SLOT_WAIT_SECONDS;
  }

  if (seconds <= 0) {
    return DEFAULT_SLOT_WAIT_SECONDS;
  }

  return seconds;
};

// slot waits use the full retry-after and never give up
export const createSlotWaiter = (config: ConfigType, onProgress?: (event: ProgressEvent) => void): WaitSlotType => async (error, signal) => {
  const retryAfter = getSlotWaitSeconds(error);
  onProgress?.({ type: 'waiting_slot', retryAfter });
  await config.sleep(retryAfter * 1000, signal);
};
