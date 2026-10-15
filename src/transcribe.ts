import type { ConfigType } from './config.js';
import { ensureCompleted } from './ensure-completed.js';
import type { CreateOptions, Input, Transcription } from './types.js';
import { withJobId } from './uploads/with-job-id.js';
import { create } from './transcriptions/create.js';
import { get } from './transcriptions/get.js';
import { waitFor } from './transcriptions/wait-for.js';

// a reused job can come back without its transcript
const findTranscript = async (config: ConfigType, job: Transcription, signal?: AbortSignal): Promise<Transcription> => {
  if (job.transcript) {
    return job;
  }

  try {
    return await get(config, job.id, { signal });
  } catch (error: unknown) {
    throw withJobId(error, job.id);
  }
};

export const transcribe = async (config: ConfigType, input: Input, options: CreateOptions = {}): Promise<Transcription> => {
  const created = await create(config, input, options);
  const finished = await waitFor(config, created.id, {
    transcription: created,
    onProgress: options.onProgress,
    signal: options.signal,
  });

  return findTranscript(config, ensureCompleted(finished), options.signal);
};
