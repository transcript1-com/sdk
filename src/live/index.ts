import { ERROR_CODES } from '../codes.js';
import {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  sleep,
  type ConfigType,
} from '../config.js';
import { Transcript1Error } from '../errors.js';
import { createLive } from './client.js';
import type { Live } from './types.js';

export type {
  Live,
  LiveCapabilities,
  LiveEndReason,
  LiveEndResult,
  LiveEvents,
  LiveLine,
  LiveSession,
  LiveSessionInfo,
  LiveSessionOptions,
  LiveStartOptions,
  LiveStatus,
  LiveTranslation,
  LiveTranslationPair,
} from './types.js';
export { Transcript1Error } from '../errors.js';
export type { ErrorCode } from '../codes.js';

export type LiveClientOptions = {
  // called before every request, so a short-lived OAuth access token can be refreshed
  getAccessToken: () => Promise<string>;
  baseUrl?: string;
  WebSocket?: typeof WebSocket;
  fetch?: typeof fetch;
};

// the live client for browsers and other runtimes without Node: no API key, no environment
export const createLiveClient = (options: LiveClientOptions): Live => {
  if (typeof options?.getAccessToken !== 'function') {
    throw new Transcript1Error(ERROR_CODES.invalid_input, 'getAccessToken must be a function that resolves to an access token');
  }

  const config: ConfigType = {
    apiKey: '',
    // a blank base url falls back to the default too
    baseUrl: (options.baseUrl?.trim() ? options.baseUrl.trim() : DEFAULT_BASE_URL).replace(/\/+$/, ''),
    fetch: options.fetch ?? globalThis.fetch.bind(globalThis),
    maxRetries: DEFAULT_MAX_RETRIES,
    WebSocket: options.WebSocket,
    sleep,
    random: Math.random,
    now: Date.now,
    getAccessToken: options.getAccessToken,
  };

  return createLive(config);
};
