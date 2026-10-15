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

export const resolveConfig = (options: ClientOptions = {}, internals: ConfigInternalsType = {}): ConfigType => {
  const apiKey = options.apiKey ?? readEnv('TRANSCRIPT1_API_KEY');
  if (!apiKey) {
    throw new Transcript1Error(ERROR_CODES.missing_api_key, 'No API key: pass apiKey or set TRANSCRIPT1_API_KEY');
  }

  const baseUrl = options.baseUrl ?? readEnv('TRANSCRIPT1_API_URL') ?? DEFAULT_BASE_URL;

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
    sleep: internals.sleep ?? sleep,
    random: internals.random ?? Math.random,
  };
};
