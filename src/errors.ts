import { ERROR_CODES } from './codes.js';
import type { Transcription } from './types.js';

export type ErrorExtra = {
  status?: number;
  details?: Record<string, unknown>;
  retryable?: boolean;
  transcriptionId?: string;
  transcription?: Transcription;
};

export class Transcript1Error extends Error {
  readonly code: string;
  readonly status?: number;
  readonly details: Record<string, unknown>;
  readonly retryable: boolean;
  readonly transcriptionId?: string;
  readonly transcription?: Transcription;

  constructor(code: string, message: string, extra: ErrorExtra = {}) {
    super(message);
    this.name = 'Transcript1Error';
    this.code = code;
    this.status = extra.status;
    this.details = extra.details ?? {};
    this.retryable = extra.retryable ?? false;
    this.transcriptionId = extra.transcriptionId;
    this.transcription = extra.transcription;
  }
}

export const buildAbortedError = (message = 'The request was aborted') => new Transcript1Error(ERROR_CODES.aborted, message);
