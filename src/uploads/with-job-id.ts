import { buildAbortedError, Transcript1Error } from '../errors.js';

export const withJobId = (error: unknown, id: string | undefined): unknown => {
  if (!(error instanceof Transcript1Error)) {
    return error;
  }

  if (!id) {
    return error;
  }

  if (error.transcriptionId) {
    return error;
  }

  const named = new Transcript1Error(error.code, error.message, {
    status: error.status,
    details: error.details,
    retryable: error.retryable,
    transcriptionId: id,
    transcription: error.transcription,
  });
  named.cause = error.cause;
  named.stack = error.stack;

  return named;
};

export const buildAbortedUploadError = (id?: string): Transcript1Error => withJobId(buildAbortedError('The upload was aborted'), id) as Transcript1Error;
