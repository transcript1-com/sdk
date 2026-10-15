import { ERROR_CODES } from './codes.js';
import { Transcript1Error } from './errors.js';

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
