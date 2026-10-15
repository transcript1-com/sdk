import { ERROR_CODES } from '../codes.js';
import type { ConfigType } from '../config.js';
import { Transcript1Error } from '../errors.js';
import { request } from '../http/request.js';
import { isTransient } from '../transient.js';
import type { Status, Transcription } from '../types.js';
import { withJobId } from '../uploads/with-job-id.js';
import { transcriptionPath } from './path.js';
import type { WaitOptionsType } from './types.js';

const WAIT_SECONDS = 60;
const MIN_POLL_GAP_MS = 2000;
const FIRST_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 30_000;

type QueryType = {
  wait: number;
  include?: string;
};

export const isTerminal = (transcription: Transcription | undefined): transcription is Transcription => {
  if (!transcription) {
    return false;
  }

  return ['completed', 'failed', 'canceled'].includes(transcription.status);
};

const getBackoffMs = (outage: number): number => Math.min(FIRST_BACKOFF_MS * (2 ** outage), MAX_BACKOFF_MS);

const reportStatus = (transcription: Transcription, previous: Status | undefined, options: WaitOptionsType): Status => {
  if (transcription.status !== previous) {
    options.onProgress?.({ type: 'status', status: transcription.status });
  }

  return transcription.status;
};

// avoid a hot loop when the server ignores wait=60
const waitForPollGap = async (config: ConfigType, askedAt: number | undefined, signal?: AbortSignal) => {
  if (askedAt === undefined) {
    return;
  }

  const pause = MIN_POLL_GAP_MS - (Date.now() - askedAt);
  if (pause > 0) {
    await config.sleep(pause, signal);
  }
};

const buildPollQuery = (options: WaitOptionsType): QueryType => {
  const query: QueryType = { wait: WAIT_SECONDS };
  if (options.includeWords) {
    query.include = 'words';
  }

  return query;
};

const poll = async (config: ConfigType, id: string, options: WaitOptionsType): Promise<Transcription> => {
  const response = await request(config, {
    method: 'GET',
    path: transcriptionPath(id),
    query: buildPollQuery(options),
    signal: options.signal,
  });

  return response.json as Transcription;
};

// the job exists, so a transient error never ends the wait
const waitToReconnect = async (config: ConfigType, error: unknown, outage: number, options: WaitOptionsType) => {
  if (options.signal?.aborted === true) {
    throw error;
  }

  if (!isTransient(error)) {
    throw error;
  }

  if (outage === 0) {
    options.onProgress?.({ type: 'reconnecting' });
  }

  await config.sleep(getBackoffMs(outage), options.signal);
};

const isAborted = (error: unknown, options: WaitOptionsType): boolean => {
  if (options.signal?.aborted === true) {
    return true;
  }

  if (!(error instanceof Transcript1Error)) {
    return false;
  }

  return error.code === ERROR_CODES.aborted;
};

const buildAbortedWaitError = (id: string, transcription: Transcription | undefined): Transcript1Error => new Transcript1Error(
  ERROR_CODES.aborted,
  'Waiting for the transcription was aborted; the job keeps running',
  {
    transcriptionId: id,
    transcription,
  },
);

export const waitFor = async (config: ConfigType, id: string, options: WaitOptionsType = {}): Promise<Transcription> => {
  transcriptionPath(id);
  let current = options.transcription;
  let status: Status | undefined;
  let askedAt: number | undefined;
  let outage = 0;
  if (current) {
    status = reportStatus(current, status, options);
  }

  try {
    /* eslint-disable no-await-in-loop */
    while (!isTerminal(current)) {
      try {
        await waitForPollGap(config, askedAt, options.signal);
        askedAt = Date.now();
        const next = await poll(config, id, options);
        outage = 0;
        current = next;
        status = reportStatus(next, status, options);
      } catch (error: unknown) {
        await waitToReconnect(config, error, outage, options);
        outage++;
        askedAt = undefined;
      }
    }
    /* eslint-enable no-await-in-loop */

    return current;
  } catch (error: unknown) {
    if (isAborted(error, options)) {
      throw buildAbortedWaitError(id, current);
    }

    throw withJobId(error, id);
  }
};
