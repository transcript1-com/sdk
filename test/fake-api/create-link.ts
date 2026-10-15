import { ERROR_CODES } from '../../src/codes.js';
import { replay, writeCreated, type CreateBodyType } from './created.js';
import { sendError, type ContextType } from './http.js';
import { addJob, refuseStart, startJob } from './jobs.js';
import type { JobType, StateType } from './state.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VIDEO_ID = /(?:youtu\.be\/|[?&]v=|\/(?:shorts|embed|live)\/)([\w-]{11})(?![\w-])/;

const parseYouTube = (value: unknown): { videoId: string; url: string } | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (!/^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//.test(value)) {
    return undefined;
  }

  const videoId = VIDEO_ID.exec(value)?.[1];
  if (!videoId) {
    return undefined;
  }

  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
};

const isReusable = (job: JobType, params: string): boolean => {
  if (job.params !== params) {
    return false;
  }

  if (['failed', 'canceled'].includes(job.status)) {
    return false;
  }

  return Date.now() - job.createdAt.getTime() < DAY_MS;
};

const findRecent = (state: StateType, params: string): JobType | undefined => {
  const newestFirst = [...state.order].reverse();

  return newestFirst.find(job => isReusable(job, params));
};

const findReused = (state: StateType, query: URLSearchParams, params: string): JobType | undefined => {
  if (query.get('reuse_recent') !== 'true') {
    return undefined;
  }

  return findRecent(state, params);
};

const isSource = (value: string): value is JobType['source'] => ['auto', 'captions', 'stt'].includes(value);

export const createLink = (context: ContextType, key: string | undefined, body: CreateBodyType) => {
  const { state, res, query } = context;
  if (body.platform !== 'youtube') {
    const extra = { supported_platforms: ['youtube'] };
    sendError(res, 422, ERROR_CODES.unsupported_platform, 'Unsupported platform', { extra });
    return;
  }

  const parsed = parseYouTube(body.url);
  if (!parsed) {
    sendError(res, 422, ERROR_CODES.invalid_url, 'Not a YouTube video link');
    return;
  }

  if (!isSource(body.source)) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'source must be auto, captions or stt');
    return;
  }

  if (body.diarize && body.source === 'captions') {
    sendError(res, 422, ERROR_CODES.invalid_request, 'diarize needs speech-to-text');
    return;
  }

  const params = JSON.stringify(['link', parsed.videoId, body.source, body.language, body.diarize]);
  if (replay(state, res, key, params)) {
    return;
  }

  const recent = findReused(state, query, params);
  if (recent) {
    writeCreated(state, res, recent, true);
    return;
  }

  if (refuseStart(state, res)) {
    return;
  }

  const job = addJob(state, {
    status: 'queued',
    platform: 'youtube',
    url: parsed.url,
    videoId: parsed.videoId,
    title: state.knobs.titles[parsed.videoId] ?? `Video ${parsed.videoId}`,
    filename: '',
    size: 0,
    source: body.source,
    language: body.language,
    diarize: body.diarize,
    idempotencyKey: key,
    params,
    token: '',
    chunks: [],
    received: new Set(),
    data: undefined,
    polls: 0,
    charged: 0,
    errorCode: undefined,
    completedAt: undefined,
  });
  startJob(state, job);
  writeCreated(state, res, job, false);
};
