import { ERROR_CODES } from '../codes.js';
import type { ConfigType } from '../config.js';
import { buildAbortedError, Transcript1Error } from '../errors.js';
import { VERSION } from '../version.js';
import { errorFromResponse } from './error-from-response.js';
import { isRetryableStatus, retryDelayMs } from './retry.js';
import { resolveUrl } from './url.js';

export type RequestOptionsType = {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retry429?: boolean;
  raw?: boolean;
  auth?: boolean;
};

export type HttpResponseType = {
  status: number;
  headers: Headers;
  json?: unknown;
  text?: string;
};

type CallType = {
  url: string;
  init: RequestInit;
  signal: AbortSignal | undefined;
  retry429: boolean;
  raw: boolean;
};

type ReplyType = {
  status: number;
  headers: Headers;
  text: string;
};

type FailureType = {
  failure: unknown;
};

const isBinary = (body: unknown): body is Uint8Array | Blob => {
  if (body instanceof Uint8Array) {
    return true;
  }

  return body instanceof Blob;
};

type EncodedBodyType = {
  body?: BodyInit;
  json: boolean;
};

const isJsonBody = (body: unknown): boolean => {
  if (Array.isArray(body)) {
    return true;
  }

  if (body === null) {
    return false;
  }

  if (typeof body !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(body) as unknown;
  if (prototype === null) {
    return true;
  }

  return prototype === Object.prototype;
};

const encodeBody = (body: unknown): EncodedBodyType => {
  if (body === undefined) {
    return { json: false };
  }

  if (isBinary(body)) {
    return { body: body as BodyInit, json: false };
  }

  if (!isJsonBody(body)) {
    const message = 'A request body must be a plain object, an array, a Uint8Array or a Blob';
    throw new Transcript1Error(ERROR_CODES.invalid_input, message);
  }

  return { body: JSON.stringify(body), json: true };
};

const isSameOrigin = (url: string, baseUrl: string): boolean => new URL(url).origin === new URL(baseUrl).origin;

// the key goes only to the api origin
const canSendKey = (config: ConfigType, url: string, options: RequestOptionsType): boolean => {
  if (options.auth === false) {
    return false;
  }

  return isSameOrigin(url, config.baseUrl);
};

const buildUrl = (config: ConfigType, options: RequestOptionsType): string => {
  const { path, query } = options;
  const url = new URL(resolveUrl(config.baseUrl, path));
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(name, String(value));
    }
  }

  return url.toString();
};

const buildInit = (config: ConfigType, url: string, options: RequestOptionsType): RequestInit => {
  const { body, json } = encodeBody(options.body);
  const headers = new Headers({ 'User-Agent': `transcript1-sdk/${VERSION}` });
  if (canSendKey(config, url, options)) {
    headers.set('Authorization', `Bearer ${config.apiKey}`);
  }

  if (json) {
    headers.set('Content-Type', 'application/json');
  }

  for (const [name, value] of Object.entries(options.headers ?? {})) {
    headers.set(name, value);
  }

  return {
    method: options.method,
    headers,
    body,
    signal: options.signal,
  };
};

const throwIfAborted = (signal: AbortSignal | undefined) => {
  if (signal?.aborted) {
    throw buildAbortedError();
  }
};

const describeFailure = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  if (!(error.cause instanceof Error)) {
    return error.message;
  }

  const cause = error.cause.message;
  if (!cause) {
    return error.message;
  }

  return `${error.message}: ${cause}`;
};

const buildNetworkError = (failure: unknown): Transcript1Error => {
  const message = `The request failed: ${describeFailure(failure)}`;
  const error = new Transcript1Error(ERROR_CODES.network_error, message, { retryable: true });
  error.cause = failure;

  return error;
};

const isJson = (headers: Headers): boolean => /json/i.test(headers.get('Content-Type') ?? '');

const buildNotJsonError = (status: number): Transcript1Error => new Transcript1Error(`http_${status}`, `the server answered HTTP ${status} without JSON`, { status });

const readReply = (reply: ReplyType, raw: boolean): HttpResponseType => {
  const { status, headers, text } = reply;
  if (status === 204) {
    return { status, headers };
  }

  if (raw) {
    return { status, headers, text };
  }

  if (!text) {
    throw buildNotJsonError(status);
  }

  if (!isJson(headers)) {
    throw buildNotJsonError(status);
  }

  try {
    return { status, headers, json: JSON.parse(text) as unknown };
  } catch {
    throw new Transcript1Error(`http_${status}`, 'the server sent a body that is not valid JSON', { status });
  }
};

// a drop while reading the body is a network failure too
const send = async (config: ConfigType, call: CallType): Promise<ReplyType | FailureType> => {
  const { url, init } = call;
  try {
    const response = await config.fetch(url, init);

    return {
      status: response.status,
      headers: response.headers,
      text: await response.text(),
    };
  } catch (error: unknown) {
    return { failure: error };
  }
};

const isFailure = (outcome: ReplyType | FailureType): outcome is FailureType => 'failure' in outcome;

const isSuccess = (status: number): boolean => {
  if (status < 200) {
    return false;
  }

  return status < 300;
};

const runAttempt = async (config: ConfigType, call: CallType, n: number): Promise<HttpResponseType> => {
  throwIfAborted(call.signal);
  const retryAttempt = async (headers: Headers) => {
    await config.sleep(retryDelayMs(n, headers, config.random), call.signal);
    return runAttempt(config, call, n + 1);
  };

  const outcome = await send(config, call);
  const isExhausted = n >= config.maxRetries;
  if (isFailure(outcome)) {
    throwIfAborted(call.signal);
    if (isExhausted) {
      throw buildNetworkError(outcome.failure);
    }

    return retryAttempt(new Headers());
  }

  if (isSuccess(outcome.status)) {
    return readReply(outcome, call.raw);
  }

  if (isExhausted) {
    throw errorFromResponse(outcome.status, outcome.headers, outcome.text);
  }

  if (!isRetryableStatus(outcome.status, call.retry429)) {
    throw errorFromResponse(outcome.status, outcome.headers, outcome.text);
  }

  return retryAttempt(outcome.headers);
};

export const request = async (config: ConfigType, options: RequestOptionsType): Promise<HttpResponseType> => {
  const url = buildUrl(config, options);
  const call: CallType = {
    url,
    init: buildInit(config, url, options),
    signal: options.signal,
    retry429: options.retry429 ?? true,
    raw: options.raw ?? false,
  };

  return runAttempt(config, call, 0);
};
