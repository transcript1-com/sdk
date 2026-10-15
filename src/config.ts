import { ERROR_CODES } from './codes.js';
import { buildAbortedError, Transcript1Error } from './errors.js';
import { readEnv } from './read-env.js';

export const DEFAULT_BASE_URL = 'https://api.transcript1.com';
export const DEFAULT_MAX_RETRIES = 2;

export type ClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
};

export type ConfigType = {
  apiKey: string;
  baseUrl: string;
  fetch: typeof fetch;
  maxRetries: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  random: () => number;
};

export type ConfigInternalsType = Partial<Pick<ConfigType, 'sleep' | 'random'>>;

const sleep = async (ms: number, signal?: AbortSignal): Promise<void> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(buildAbortedError());
    return;
  }

  const onAbort = () => {
    clearTimeout(timer);
    reject(buildAbortedError());
  };

  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);

  signal?.addEventListener('abort', onAbort, { once: true });
});

const MAX_RETRIES_LIMIT = 10;

const trimValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed;
};

const buildMaxRetriesError = () => new Transcript1Error(
  ERROR_CODES.invalid_input,
  `maxRetries must be an integer from 0 to ${MAX_RETRIES_LIMIT}`,
);

const resolveMaxRetries = (value: number | undefined): number => {
  if (value === undefined) {
    return DEFAULT_MAX_RETRIES;
  }

  if (!Number.isInteger(value)) {
    throw buildMaxRetriesError();
  }

  if (value < 0) {
    throw buildMaxRetriesError();
  }

  if (value > MAX_RETRIES_LIMIT) {
    throw buildMaxRetriesError();
  }

  return value;
};

export const resolveConfig = (options: ClientOptions = {}, internals: ConfigInternalsType = {}): ConfigType => {
  const apiKey = trimValue(options.apiKey) ?? trimValue(readEnv('TRANSCRIPT1_API_KEY'));
  if (!apiKey) {
    throw new Transcript1Error(ERROR_CODES.missing_api_key, 'No API key: pass apiKey or set TRANSCRIPT1_API_KEY');
  }

  const baseUrl = trimValue(options.baseUrl) ?? trimValue(readEnv('TRANSCRIPT1_API_URL')) ?? DEFAULT_BASE_URL;

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    maxRetries: resolveMaxRetries(options.maxRetries),
    sleep: internals.sleep ?? sleep,
    random: internals.random ?? Math.random,
  };
};
