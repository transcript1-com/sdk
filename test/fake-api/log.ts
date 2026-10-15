import type { IncomingMessage } from 'node:http';
import type { RecordedRequestType, StateType } from './state.js';

const CHUNK_PATH = /\/v1\/transcriptions\/[^/]+\/upload\/chunks\/(\d+)$/;

const findChunkIndex = (method: string, url: URL): number | undefined => {
  if (method !== 'PUT') {
    return undefined;
  }

  const match = CHUNK_PATH.exec(url.pathname);
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
};

const buildLogLine = (method: string, url: URL, chunk: number | undefined): string => {
  if (chunk === undefined) {
    return `${method} ${url.pathname}`;
  }

  return `PUT chunk ${chunk}`;
};

export const recordRequest = (state: StateType, req: IncomingMessage, url: URL): RecordedRequestType => {
  const method = req.method ?? 'GET';
  const request: RecordedRequestType = {
    method,
    path: url.pathname,
    query: url.searchParams,
    headers: { ...req.headers },
    body: undefined,
    chunk: findChunkIndex(method, url),
  };
  state.requests.push(request);
  state.log.push(buildLogLine(method, url, request.chunk));

  return request;
};

export const getUploadedBytes = (state: StateType, id: string): Uint8Array => new Uint8Array(state.jobs.get(id)?.data ?? []);
