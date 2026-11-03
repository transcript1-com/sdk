import { ERROR_CODES } from '../codes.js';
import type { ConfigType } from '../config.js';
import { Transcript1Error } from '../errors.js';
import { request } from '../http/request.js';
import { openSession, type SessionDeps } from './session.js';
import type {
  Live,
  LiveCapabilities,
  LiveSession,
  LiveSessionInfo,
  LiveStartOptions,
} from './types.js';
import {
  buildCreateBody,
  DEFAULT_SAMPLE_RATE,
  parseCapabilities,
  parseCreated,
  parseCredentials,
  parseSessionInfo,
} from './wire.js';

type ReadOptions = {
  signal?: AbortSignal;
};

const resolveWebSocket = (config: ConfigType): typeof WebSocket => {
  const Ctor = config.WebSocket ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!Ctor) {
    throw new Transcript1Error(
      ERROR_CODES.websocket_unavailable,
      'No WebSocket implementation: use Node 22+, Bun, Deno or a browser, or pass one with new Transcript1({ WebSocket }), for example from the ws package',
    );
  }

  return Ctor;
};

const sessionPath = (id: string): string => `/v1/live/sessions/${encodeURIComponent(id)}`;

// a resume token request is retried by the reconnect loop's own backoff, not by the request retries
const requestToken = async (config: ConfigType, id: string) => {
  const response = await request({ ...config, maxRetries: 0 }, { method: 'POST', path: `${sessionPath(id)}/token` });

  return parseCredentials(response.json);
};

const start = async (config: ConfigType, options: LiveStartOptions = {}): Promise<LiveSession> => {
  const Ctor = resolveWebSocket(config);
  // creating a session is not idempotent, so a failed request is never retried
  const response = await request({ ...config, maxRetries: 0 }, {
    method: 'POST',
    path: '/v1/live/sessions',
    body: buildCreateBody(options),
    signal: options.signal,
  });
  const created = parseCreated(response.json);

  const deps: SessionDeps = {
    Ctor,
    sampleRate: options.sampleRate ?? DEFAULT_SAMPLE_RATE,
    sleep: config.sleep,
    now: config.now,
    requestToken: async () => requestToken(config, created.id),
    readInfo: async () => get(config, created.id),
  };

  return openSession(deps, created, options.signal);
};

const get = async (config: ConfigType, id: string, options: ReadOptions = {}): Promise<LiveSessionInfo> => {
  const response = await request(config, {
    method: 'GET',
    path: sessionPath(id),
    signal: options.signal,
  });

  return parseSessionInfo(response.json);
};

const capabilities = async (config: ConfigType, options: ReadOptions = {}): Promise<LiveCapabilities> => {
  const response = await request(config, { method: 'GET', path: '/v1/live/capabilities', signal: options.signal });

  return parseCapabilities(response.json);
};

export const createLive = (config: ConfigType): Live => ({
  start: async options => start(config, options),
  get: async (id, options) => get(config, id, options),
  capabilities: async options => capabilities(config, options),
});
