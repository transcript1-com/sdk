import { ERROR_CODES } from '../codes.js';
import type { ConfigType } from '../config.js';
import { Transcript1Error } from '../errors.js';
import type { ChunkSourceType, FileInputType } from '../inputs/types.js';
import type { Transcription } from '../types.js';
import { cancelUpload } from './cancel.js';
import { complete } from './complete.js';
import { createUpload } from './create-upload.js';
import { sendChunks } from './send-chunks.js';
import type { UploadOptionsType, UploadType } from './types.js';
import { buildAbortedUploadError, withJobId } from './with-job-id.js';

const closeQuietly = async (source: ChunkSourceType) => {
  await source.close().catch(() => null);
};

const cancelQuietly = async (config: ConfigType, id: string | undefined) => {
  if (!id) {
    return;
  }

  await cancelUpload(config, id).catch(() => null);
};

const isSourceError = (error: unknown): boolean => {
  if (!(error instanceof Transcript1Error)) {
    return true;
  }

  return error.code === ERROR_CODES.invalid_input;
};

const handleFailure = async (config: ConfigType, error: unknown, jobId: string | undefined, signal?: AbortSignal): Promise<unknown> => {
  if (signal?.aborted) {
    await cancelQuietly(config, jobId);
    return buildAbortedUploadError(jobId);
  }

  if (isSourceError(error)) {
    await cancelQuietly(config, jobId);
  }

  return withJobId(error, jobId);
};

const startUpload = async (config: ConfigType, options: UploadOptionsType): Promise<Transcription> => {
  if (options.signal?.aborted) {
    throw buildAbortedUploadError();
  }

  return createUpload(config, options, options.signal);
};

const finishUpload = async (config: ConfigType, file: FileInputType, options: UploadOptionsType, created: Transcription): Promise<Transcription> => {
  if (created.status !== 'awaiting_upload') {
    return created;
  }

  if (!created.upload) {
    throw new Transcript1Error(ERROR_CODES.invalid_state, 'The server sent no upload plan');
  }

  options.onProgress?.({ type: 'status', status: 'awaiting_upload' });
  const upload: UploadType = {
    config,
    file,
    source: file.source,
    options,
    id: created.id,
    template: created.upload.chunk_url_template,
    chunks: created.upload.chunks,
    token: created.upload.headers['X-Upload-Token'],
    generation: 0,
    renewing: undefined,
    received: new Set(),
    counted: new Set(),
    sent: 0,
  };
  await sendChunks(upload, upload.chunks, options.signal);

  return complete(upload, options.signal);
};

export const uploadFile = async (config: ConfigType, file: FileInputType, options: UploadOptionsType): Promise<Transcription> => {
  let jobId: string | undefined;
  let done: Transcription;
  try {
    const created = await startUpload(config, options);
    jobId = created.id;
    done = await finishUpload(config, file, options, created);
  } catch (error: unknown) {
    await closeQuietly(file.source);
    throw await handleFailure(config, error, jobId, options.signal);
  }

  await closeQuietly(file.source);

  return done;
};
