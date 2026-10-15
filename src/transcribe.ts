import { ERROR_CODES } from './codes.js';
import type { ConfigType } from './config.js';
import { ensureCompleted } from './ensure-completed.js';
import { Transcript1Error } from './errors.js';
import { create } from './transcriptions/create.js';
import { get } from './transcriptions/get.js';
import { waitFor } from './transcriptions/wait-for.js';
import type {
  CompletedTranscription,
  CreateOptions,
  Input,
  Transcription,
} from './types.js';
import { withJobId } from './uploads/with-job-id.js';

const hasTranscript = (job: Transcription): job is CompletedTranscription => {
  if (job.status !== 'completed') {
    return false;
  }

  return job.transcript !== undefined;
};

const getJob = async (config: ConfigType, id: string, signal?: AbortSignal): Promise<Transcription> => {
  try {
    return await get(config, id, { signal });
  } catch (error: unknown) {
    throw withJobId(error, id);
  }
};

// a reused job can come back without its transcript
const findTranscript = async (config: ConfigType, job: Transcription, signal?: AbortSignal): Promise<CompletedTranscription> => {
  if (hasTranscript(job)) {
    return job;
  }

  const fetched = await getJob(config, job.id, signal);
  if (!hasTranscript(fetched)) {
    throw new Transcript1Error(ERROR_CODES.internal_error, 'The API returned a completed transcription without a transcript', {
      transcriptionId: job.id,
      transcription: fetched,
    });
  }

  return fetched;
};

export const transcribe = async (config: ConfigType, input: Input, options: CreateOptions = {}): Promise<CompletedTranscription> => {
  const created = await create(config, input, options);
  const finished = await waitFor(config, created.id, {
    transcription: created,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  return findTranscript(config, ensureCompleted(finished), options.signal);
};
