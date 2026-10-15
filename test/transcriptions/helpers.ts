import type { ConfigType } from '../../src/config.js';
import type { ProgressEvent } from '../../src/types.js';
import type { FakeApiType, RecordedRequestType } from '../fake-api/server.js';
import { createTestConfig } from '../http/helpers.js';

export { startApi } from '../uploads/helpers.js';

export const LINK = 'https://youtu.be/dQw4w9WgXcQ';
export const CANONICAL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

type ApiOptionsType = {
  fetch?: typeof fetch;
  maxRetries?: number;
  sleep?: ConfigType['sleep'];
};

export const createApiConfig = (fake: FakeApiType, options: ApiOptionsType = {}): { config: ConfigType; sleeps: number[] } => createTestConfig({ ...options, baseUrl: fake.url });

export const createRecorder = (): { events: ProgressEvent[]; onProgress: (event: ProgressEvent) => void } => {
  const events: ProgressEvent[] = [];

  return {
    events,
    onProgress(event) {
      events.push(event);
    },
  };
};

export const getStatuses = (events: ProgressEvent[]): string[] => {
  const statuses: string[] = [];
  for (const event of events) {
    if (event.type === 'status') {
      statuses.push(event.status);
    }
  }

  return statuses;
};

export const filterByType = (events: ProgressEvent[], type: ProgressEvent['type']): ProgressEvent[] => events.filter(event => event.type === type);

const isCreate = (request: RecordedRequestType): boolean => {
  if (request.method !== 'POST') {
    return false;
  }

  return request.path === '/v1/transcriptions';
};

const isPoll = (request: RecordedRequestType): boolean => {
  if (request.method !== 'GET') {
    return false;
  }

  return /^\/v1\/transcriptions\/[^/]+$/.test(request.path);
};

export const findCreates = (fake: FakeApiType): RecordedRequestType[] => fake.requests.filter(request => isCreate(request));

export const findPolls = (fake: FakeApiType): RecordedRequestType[] => fake.requests.filter(request => isPoll(request));

export const parseBody = (request: RecordedRequestType | undefined): unknown => JSON.parse(request?.body?.toString() ?? '{}');

const isPollUrl = (input: string | URL | Request, init?: RequestInit): boolean => {
  if ((init?.method ?? 'GET') !== 'GET') {
    return false;
  }

  return /\/v1\/transcriptions\/[^/]+$/.test(new URL(String(input)).pathname);
};

export const hookBeforePoll = (hooks: Record<number, () => void | Promise<void>>): typeof fetch => {
  let seen = 0;

  return (async (input: string | URL | Request, init?: RequestInit) => {
    if (isPollUrl(input, init)) {
      seen++;
      await hooks[seen]?.();
    }

    return fetch(input, init);
  }) as typeof fetch;
};
