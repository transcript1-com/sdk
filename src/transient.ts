import { ERROR_CODES } from './codes.js';
import { Transcript1Error } from './errors.js';

export const isTransient = (error: unknown): boolean => {
  if (!(error instanceof Transcript1Error)) {
    return false;
  }

  if (error.code === ERROR_CODES.network_error) {
    return true;
  }

  return [429, 500, 502, 503, 504].includes(error.status ?? 0);
};
