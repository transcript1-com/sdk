import { CANCELED_CODE, ERROR_CODES } from './codes.js';
import { Transcript1Error } from './errors.js';
import type { Transcription } from './types.js';

export const ensureCompleted = (job: Transcription): Transcription => {
  if (job.status === 'completed') {
    return job;
  }

  const extra = { transcriptionId: job.id, transcription: job };
  if (job.status === 'canceled') {
    throw new Transcript1Error(CANCELED_CODE, 'The transcription was canceled', extra);
  }

  throw new Transcript1Error(
    job.error?.code ?? ERROR_CODES.transcription_failed,
    job.error?.message ?? 'The transcription failed',
    extra,
  );
};
