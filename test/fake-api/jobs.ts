import type { ServerResponse } from 'node:http';
import { ERROR_CODES } from '../../src/codes.js';
import type { Chunk, Status } from '../../src/types.js';
import { sendError, type ContextType } from './http.js';
import type { JobType, StateType } from './state.js';

const BILLING_URL = 'https://transcript1.com/dashboard/billing';

export const isTerminal = (status: Status): boolean => ['completed', 'failed', 'canceled'].includes(status);

export const getJobStatusCode = (job: JobType): number => {
  if (isTerminal(job.status)) {
    return 200;
  }

  return 202;
};

export const addJob = (state: StateType, job: Omit<JobType, 'id' | 'seq' | 'createdAt'>): JobType => {
  state.nextId++;
  const added: JobType = {
    ...job,
    id: `tr_${state.nextId}`,
    seq: state.nextId,
    createdAt: new Date(),
  };
  state.jobs.set(added.id, added);
  state.order.push(added);

  return added;
};

export const removeJob = (state: StateType, job: JobType) => {
  state.jobs.delete(job.id);
  state.order.splice(state.order.indexOf(job), 1);
};

export const findOwnedJob = (context: ContextType): JobType | undefined => {
  const { state, res, params } = context;
  const job = state.jobs.get(params.id ?? '');
  if (!job) {
    sendError(res, 404, ERROR_CODES.not_found, 'Transcription not found');
  }

  return job;
};

export const findByKey = (state: StateType, key: string | undefined): JobType | undefined => {
  if (!key) {
    return undefined;
  }

  return state.order.find(job => job.idempotencyKey === key);
};

const isActive = (job: JobType): boolean => {
  if (job.status === 'awaiting_upload') {
    return false;
  }

  return !isTerminal(job.status);
};

const countActive = (state: StateType): number => state.order.filter(job => isActive(job)).length;

export const updatePeak = (state: StateType) => {
  state.peakActive = Math.max(state.peakActive, countActive(state));
};

export const issueToken = (state: StateType, job: JobType) => {
  state.nextToken++;
  job.token = `ut_${job.id}_${state.nextToken}`;
};

export const planChunks = (size: number, chunkSize: number): Chunk[] => {
  const chunks: Chunk[] = [];
  for (let offset = 0; offset < size; offset += chunkSize) {
    chunks.push({
      index: chunks.length,
      offset,
      size: Math.min(chunkSize, size - offset),
    });
  }

  return chunks;
};

export const findMissingChunks = (job: JobType): number[] => {
  const missing = job.chunks.filter(chunk => !job.received.has(chunk.index));

  return missing.map(chunk => chunk.index);
};

const charge = (state: StateType, job: JobType) => {
  if (state.knobs.minutesLeft >= 0) {
    state.knobs.minutesLeft -= state.knobs.minutesPerJob;
  }

  job.charged = state.knobs.minutesPerJob;
};

export const refund = (state: StateType, job: JobType) => {
  if (state.knobs.minutesLeft >= 0) {
    state.knobs.minutesLeft += job.charged;
  }

  job.charged = 0;
};

export const startJob = (state: StateType, job: JobType) => {
  job.status = 'queued';
  job.token = '';
  charge(state, job);
  updatePeak(state);
};

export const refuseMinutes = (state: StateType, res: ServerResponse): boolean => {
  const { minutesLeft, minutesPerJob } = state.knobs;
  if (minutesLeft < 0) {
    return false;
  }

  if (minutesLeft >= minutesPerJob) {
    return false;
  }

  const extra = {
    action_url: BILLING_URL,
    minutes_needed: minutesPerJob,
    minutes_remaining: Math.max(minutesLeft, 0),
  };
  sendError(res, 402, ERROR_CODES.insufficient_minutes, 'Not enough minutes', { extra });

  return true;
};

const isOverActiveLimit = (state: StateType): boolean => {
  const { activeLimit } = state.knobs;
  if (activeLimit <= 0) {
    return false;
  }

  return countActive(state) >= activeLimit;
};

export const refuseStart = (state: StateType, res: ServerResponse): boolean => {
  if (isOverActiveLimit(state)) {
    const message = `Too many active transcriptions (limit ${state.knobs.activeLimit})`;
    sendError(res, 429, ERROR_CODES.too_many_active_jobs, message, { headers: { 'Retry-After': '1' } });
    return true;
  }

  return refuseMinutes(state, res);
};

export const advanceJob = (state: StateType, job: JobType) => {
  if (isTerminal(job.status)) {
    return;
  }

  if (job.status === 'awaiting_upload') {
    return;
  }

  job.polls++;
  if (job.polls < state.knobs.polls) {
    job.status = 'transcribing';
    return;
  }

  job.completedAt = new Date();
  if (state.knobs.failCode) {
    job.status = 'failed';
    job.errorCode = state.knobs.failCode;
    refund(state, job);
    return;
  }

  job.status = 'completed';
};
