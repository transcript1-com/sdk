import { ERROR_CODES } from '../../src/codes.js';
import { detectLinkPlatform } from '../../src/inputs/detect-platform.js';
import type { LinkPlatformType } from '../../src/inputs/types.js';
import { replay, writeCreated, type CreateBodyType } from './created.js';
import { sendError, type ContextType } from './http.js';
import { addJob, refuseStart, startJob } from './jobs.js';
import type { JobType, StateType } from './state.js';

const PLATFORMS = ['youtube', 'x', 'tiktok', 'instagram', 'facebook', 'bluesky'];
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

const parseLink = (value: unknown): { platform: LinkPlatformType; videoId: string; url: string } | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const platform = detectLinkPlatform(value);
  if (!platform) {
    return undefined;
  }

  if (platform !== 'youtube') {
    return { platform, videoId: '', url: value.trim() };
  }

  const parsed = parseYouTube(value);
  if (!parsed) {
    return undefined;
  }

  return { platform, ...parsed };
};

export const createLink = (context: ContextType, key: string | undefined, body: CreateBodyType) => {
  const { state, res, query } = context;
  const isPlatformGiven = body.platform !== undefined;
  if (isPlatformGiven && !PLATFORMS.includes(String(body.platform))) {
    const extra = { supported_platforms: PLATFORMS };
    sendError(res, 422, ERROR_CODES.unsupported_platform, 'Unsupported platform', { extra });
    return;
  }

  const parsed = parseLink(body.url);
  if (!parsed) {
    sendError(res, 422, ERROR_CODES.invalid_url, 'Not a supported link');
    return;
  }

  if (isPlatformGiven && body.platform !== parsed.platform) {
    sendError(res, 422, ERROR_CODES.invalid_url, 'The link is from another platform');
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

  const params = JSON.stringify(['link', parsed.platform, parsed.videoId || parsed.url, body.source, body.language, body.diarize]);
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
    platform: parsed.platform,
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
