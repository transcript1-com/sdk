import type { IncomingMessage, ServerResponse } from 'node:http';
import { ERROR_CODES } from '../../src/codes.js';
import type { StateType } from './state.js';

export type ContextType = {
  state: StateType;
  req: IncomingMessage;
  res: ServerResponse;
  params: { id?: string; index?: string };
  query: URLSearchParams;
  body: () => Promise<Buffer>;
};

export type HandlerType = (context: ContextType) => Promise<void> | void;

const CODES_BY_STATUS: Record<number, string> = {
  400: ERROR_CODES.invalid_request,
  401: ERROR_CODES.unauthorized,
  404: ERROR_CODES.not_found,
  409: ERROR_CODES.invalid_state,
  422: ERROR_CODES.invalid_request,
  429: ERROR_CODES.rate_limited,
  503: ERROR_CODES.service_unavailable,
};

export const getCodeForStatus = (status: number): string => CODES_BY_STATUS[status] ?? ERROR_CODES.internal_error;

export const buildRetryHeaders = (status: number): Record<string, string> => {
  if (status === 429) {
    return { 'Retry-After': '1' };
  }

  return {};
};

type HeaderMapType = Record<string, string>;

export const send = (res: ServerResponse, status: number, body: string | Uint8Array, headers: HeaderMapType = {}) => {
  res.writeHead(status, headers);
  res.end(body);
};

export const sendJson = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  send(res, status, JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
};

type ErrorOptionsType = {
  extra?: Record<string, unknown>;
  headers?: Record<string, string>;
};

const isRetryableStatus = (status: number): boolean => {
  if (status === 429) {
    return true;
  }

  return status >= 500;
};

/* eslint-disable max-params */
export const sendError = (
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  options: ErrorOptionsType = {},
) => {
  const error = {
    code,
    message,
    retryable: isRetryableStatus(status),
    ...options.extra,
  };
  sendJson(res, status, { error }, options.headers);
};
/* eslint-enable max-params */

export const readBody = async (req: IncomingMessage): Promise<Buffer> => {
  const parts: Buffer[] = [];
  for await (const part of req) {
    parts.push(part as Buffer);
  }

  return Buffer.concat(parts);
};

export const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return !Array.isArray(value);
};

export const parseJson = async (context: ContextType): Promise<Record<string, unknown> | undefined> => {
  const bytes = await context.body();
  try {
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(parsed)) {
      return undefined;
    }

    return parsed;
  } catch {
    return undefined;
  }
};
