import { ERROR_CODES } from '../codes.js';
import type { ConfigType } from '../config.js';
import { Transcript1Error } from '../errors.js';
import type { ProgressEvent } from '../types.js';

const DEFAULT_SLOT_WAIT_SECONDS = 10;

export type WaitSlotType = (error: Transcript1Error, signal?: AbortSignal) => Promise<void>;

export const isSlotBusy = (error: unknown): error is Transcript1Error => {
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
