import { CANCELED_CODE } from './codes.js';
import { Transcript1Error } from './errors.js';
import type { Transcription } from './types.js';

const FAILED_CODE = 'transcription_failed';

export const ensureCompleted = (job: Transcription): Transcription => {
  if (job.status === 'completed') {
    return job;
  }

  const extra = { transcriptionId: job.id, transcription: job };
  if (job.status === 'canceled') {
    throw new Transcript1Error(CANCELED_CODE, 'The transcription was canceled', extra);
  }

  throw new Transcript1Error(
    job.error?.code ?? FAILED_CODE,
    job.error?.message ?? 'The transcription failed',
    extra,
  );
};
