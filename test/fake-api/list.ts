import { ERROR_CODES } from '../../src/codes.js';
import { sendError, sendJson, type HandlerType } from './http.js';
import { serialize } from './serialize.js';
import type { JobType } from './state.js';

const MAX_LIMIT = 100;

type FiltersType = {
  after: number;
  status: string | null;
  platform: string | null;
};

const encodeCursor = (seq: number): string => Buffer.from(JSON.stringify({ seq })).toString('base64url');

const decodeCursor = (cursor: string): number | undefined => {
  try {
    const { seq } = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { seq?: unknown };
    if (typeof seq !== 'number') {
      return undefined;
    }

    return seq;
  } catch {
    return undefined;
  }
};

const readLimit = (rawLimit: string | null, pageSize: number): number => {
  if (rawLimit === null) {
    return pageSize;
  }

  return Number(rawLimit);
};

const isValidLimit = (limit: number): boolean => {
  if (!Number.isInteger(limit)) {
    return false;
  }

  if (limit < 1) {
    return false;
  }

  return limit <= MAX_LIMIT;
};

const readAfter = (rawCursor: string | null): number | undefined => {
  if (rawCursor === null) {
    return Number.POSITIVE_INFINITY;
  }

  return decodeCursor(rawCursor);
};

const matchesFilter = (value: string, filter: string | null): boolean => {
  if (!filter) {
    return true;
  }

  return value === filter;
};

const matchesFilters = (job: JobType, filters: FiltersType): boolean => {
  if (job.seq >= filters.after) {
    return false;
  }

  if (!matchesFilter(job.status, filters.status)) {
    return false;
  }

  return matchesFilter(job.platform, filters.platform);
};

const buildNextCursor = (matches: JobType[], limit: number, last: JobType | undefined): string | null => {
  if (matches.length <= limit) {
    return null;
  }

  if (!last) {
    return null;
  }

  return encodeCursor(last.seq);
};

export const list: HandlerType = context => {
  const { state, res, query } = context;
  const limit = readLimit(query.get('limit'), state.knobs.pageSize);
  if (!isValidLimit(limit)) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'limit must be between 1 and 100');
    return;
  }

  const after = readAfter(query.get('cursor'));
  if (after === undefined) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'Invalid cursor');
    return;
  }

  const filters: FiltersType = {
    after,
    status: query.get('status'),
    platform: query.get('platform'),
  };
  const matches = [...state.order].reverse().filter(job => matchesFilters(job, filters));
  const page = matches.slice(0, limit);
  sendJson(res, 200, {
    object: 'list',
    data: page.map(job => serialize(state, job, false)),
    next_cursor: buildNextCursor(matches, limit, page.at(-1)),
  });
};
