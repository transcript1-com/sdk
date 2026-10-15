import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ERROR_CODES } from '../../src/codes.js';
import { account } from './account.js';
import { getProgress, putChunk } from './chunks.js';
import { complete } from './complete.js';
import { create } from './create.js';
import { remove } from './delete.js';
import { get } from './get.js';
import {
  readBody,
  sendError,
  type ContextType,
  type HandlerType,
} from './http.js';
import { list } from './list.js';
import { getUploadedBytes, recordRequest } from './log.js';
import {
  createState,
  type KnobsType,
  type RecordedRequestType,
  type StateType,
} from './state.js';

export type { KnobsType, RecordedRequestType } from './state.js';

export type FakeApiType = {
  url: string;
  log: string[];
  requests: RecordedRequestType[];
  knobs: KnobsType;
  peakChunks: () => number;
  peakActive: () => number;
  uploaded: (id: string) => Uint8Array;
  close: () => Promise<void>;
};

type RouteType = {
  method: string;
  pattern: RegExp;
  handler: HandlerType;
  bearer: boolean;
};

const ROUTES: RouteType[] = [
  {
    method: 'POST',
    pattern: /^\/v1\/transcriptions$/,
    handler: create,
    bearer: true,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/transcriptions$/,
    handler: list,
    bearer: true,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/transcriptions\/(?<id>[^/]+)$/,
    handler: get,
    bearer: true,
  },
  {
    method: 'DELETE',
    pattern: /^\/v1\/transcriptions\/(?<id>[^/]+)$/,
    handler: remove,
    bearer: true,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/transcriptions\/(?<id>[^/]+)\/upload$/,
    handler: getProgress,
    bearer: true,
  },
  {
    method: 'POST',
    pattern: /^\/v1\/transcriptions\/(?<id>[^/]+)\/upload\/complete$/,
    handler: complete,
    bearer: true,
  },
  {
    method: 'PUT',
    pattern: /^\/v1\/transcriptions\/(?<id>[^/]+)\/upload\/chunks\/(?<index>[^/]+)$/,
    handler: putChunk,
    bearer: false,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/account$/,
    handler: account,
    bearer: true,
  },
];

const stripPrefix = (pathname: string, prefix: string): string | undefined => {
  if (!prefix) {
    return pathname;
  }

  if (pathname === prefix) {
    return '/';
  }

  if (!pathname.startsWith(`${prefix}/`)) {
    return undefined;
  }

  return pathname.slice(prefix.length);
};

const findRoute = (method: string | undefined, path: string | undefined) => {
  if (path === undefined) {
    return undefined;
  }

  for (const route of ROUTES) {
    const found = route.pattern.exec(path);
    if (!found) {
      continue;
    }

    if (route.method !== method) {
      continue;
    }

    return { route, found };
  }

  return undefined;
};

const isAuthorized = (state: StateType, req: IncomingMessage, route: RouteType): boolean => {
  if (!route.bearer) {
    return true;
  }

  return req.headers.authorization === `Bearer ${state.knobs.key}`;
};

const handle = async (state: StateType, req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', 'http://fake-api.local');
  const request = recordRequest(state, req, url);
  const hit = findRoute(req.method, stripPrefix(url.pathname, state.knobs.prefix));
  if (!hit) {
    sendError(res, 404, ERROR_CODES.not_found, 'Route not found');
    return;
  }

  if (!isAuthorized(state, req, hit.route)) {
    const headers = { 'WWW-Authenticate': 'Bearer realm="transcript1"' };
    sendError(res, 401, ERROR_CODES.unauthorized, 'Invalid or missing API key', { headers });
    return;
  }

  let pending: Promise<Buffer> | undefined;
  const body = async () => {
    pending = pending ?? readBody(req).then(bytes => {
      request.body = bytes;
      return bytes;
    });

    return pending;
  };

  const context: ContextType = {
    state,
    req,
    res,
    params: { ...hit.found.groups },
    query: url.searchParams,
    body,
  };
  await hit.route.handler(context);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Unexpected error';
};

export const startFakeApi = async (options: Partial<KnobsType> = {}): Promise<FakeApiType> => {
  const state = createState(options);
  const server = createServer((req, res) => {
    handle(state, req, res).catch((error: unknown) => {
      if (!res.headersSent) {
        sendError(res, 500, ERROR_CODES.internal_error, getErrorMessage(error));
      }
    });
  });
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}${state.knobs.prefix}`,
    log: state.log,
    requests: state.requests,
    knobs: state.knobs,
    peakChunks: () => state.peakChunks,
    peakActive: () => state.peakActive,
    uploaded: id => getUploadedBytes(state, id),
    async close() {
      state.release();
      await new Promise<void>(resolve => {
        server.close(() => {
          resolve();
        });
        server.closeAllConnections();
      });
    },
  };
};
