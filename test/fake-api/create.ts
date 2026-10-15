import { ERROR_CODES } from '../../src/codes.js';
import type { CreateBodyType } from './created.js';
import { createLink } from './create-link.js';
import { createUpload } from './create-upload.js';
import {
  isRecord,
  parseJson,
  sendError,
  type HandlerType,
} from './http.js';

const readString = (value: unknown, fallback: string): string => {
  if (typeof value !== 'string') {
    return fallback;
  }

  return value;
};

const readUpload = (value: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  return value;
};

export const create: HandlerType = async context => {
  const { req, res } = context;
  const raw = await parseJson(context);
  if (!raw) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'Body must be JSON');
    return;
  }

  const body: CreateBodyType = {
    platform: raw.platform,
    url: raw.url,
    source: readString(raw.source, 'auto'),
    language: readString(raw.language, 'auto'),
    diarize: raw.diarize === true,
    upload: readUpload(raw.upload),
  };
  const key = req.headers['idempotency-key'];
  let idempotencyKey: string | undefined;
  if (typeof key === 'string') {
    idempotencyKey = key;
  }

  if (body.upload) {
    createUpload(context, idempotencyKey, body);
    return;
  }

  createLink(context, idempotencyKey, body);
};
