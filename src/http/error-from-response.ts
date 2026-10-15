import { Transcript1Error } from '../errors.js';
import { retryAfterMs } from './retry.js';

const isRecord = (value: unknown): value is Record<string, unknown> => {
  if (value === null) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return !Array.isArray(value);
};

const parseEnvelope = (text: string): Record<string, unknown> | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) {
    return undefined;
  }

  const { error } = parsed;
  if (!isRecord(error)) {
    return undefined;
  }

  if (typeof error.code !== 'string') {
    return undefined;
  }

  if (!error.code) {
    return undefined;
  }

  return error;
};

const getRetryAfterSeconds = (headers: Headers): number | undefined => {
  const ms = retryAfterMs(headers);
  if (ms === undefined) {
    return undefined;
  }

  return Math.ceil(ms / 1000);
};

const buildRetryDetails = (headers: Headers): Record<string, unknown> => {
  const details: Record<string, unknown> = {};
  const retryAfter = getRetryAfterSeconds(headers);
  if (retryAfter !== undefined) {
    details.retry_after = retryAfter;
  }

  return details;
};

const isRetryableAnswer = (status: number): boolean => {
  if (status === 429) {
    return true;
  }

  return status >= 500;
};

const getMessage = (envelope: Record<string, unknown>): string => {
  if (typeof envelope.message !== 'string') {
    return '';
  }

  return envelope.message;
};

export const errorFromResponse = (status: number, headers: Headers, text: string): Transcript1Error => {
  const envelope = parseEnvelope(text);
  const retryDetails = buildRetryDetails(headers);
  if (!envelope) {
    return new Transcript1Error(`http_${status}`, `the server answered HTTP ${status}`, {
      status,
      details: retryDetails,
      retryable: isRetryableAnswer(status),
    });
  }

  const fields = Object.entries(envelope).filter(([name]) => !['code', 'message', 'retryable'].includes(name));

  return new Transcript1Error(String(envelope.code), getMessage(envelope), {
    status,
    details: { ...Object.fromEntries(fields), ...retryDetails },
    retryable: envelope.retryable === true,
  });
};
