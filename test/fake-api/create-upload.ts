import { ERROR_CODES } from '../../src/codes.js';
import { replay, writeCreated, type CreateBodyType } from './created.js';
import { sendError, type ContextType } from './http.js';
import {
  addJob,
  issueToken,
  planChunks,
  refuseMinutes,
} from './jobs.js';

const MAX_UPLOAD_BYTES = 2_000_000_000;

type UploadFileType = {
  filename: string;
  size: number;
};

const readUploadFile = (upload: Record<string, unknown>): UploadFileType | undefined => {
  const { filename, size } = upload;
  if (typeof filename !== 'string') {
    return undefined;
  }

  if (!filename) {
    return undefined;
  }

  if (typeof size !== 'number') {
    return undefined;
  }

  if (!Number.isInteger(size)) {
    return undefined;
  }

  if (size < 1) {
    return undefined;
  }

  return { filename, size };
};

const isSupportedFile = (filename: string): boolean => {
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';

  return ['mp3', 'wav', 'm4a', 'flac', 'ogg', 'opus', 'mp4', 'mov', 'webm', 'mkv'].includes(extension);
};

const isUploadSource = (value: string): value is 'auto' | 'stt' => ['auto', 'stt'].includes(value);

export const createUpload = (context: ContextType, key: string | undefined, body: CreateBodyType) => {
  const { state, res, query } = context;
  if (query.get('reuse_recent') === 'true') {
    sendError(res, 422, ERROR_CODES.invalid_request, 'reuse_recent is available only for platform URLs');
    return;
  }

  const upload = body.upload ?? {};
  const file = readUploadFile(upload);
  if (!file) {
    const message = 'upload.filename and a positive upload.size are required';
    sendError(res, 422, ERROR_CODES.invalid_request, message);
    return;
  }

  const { filename, size } = file;
  if (!isSupportedFile(filename)) {
    sendError(res, 422, ERROR_CODES.unsupported_media, 'Unsupported file type');
    return;
  }

  if (size > MAX_UPLOAD_BYTES) {
    const extra = { max_bytes: MAX_UPLOAD_BYTES };
    sendError(res, 413, ERROR_CODES.media_too_large, 'File exceeds the maximum size', { extra });
    return;
  }

  if (!isUploadSource(body.source)) {
    sendError(res, 422, ERROR_CODES.invalid_request, 'source must be auto or stt for uploads');
    return;
  }

  const params = JSON.stringify(['upload', filename, size, upload.mime_type, body.source, body.language, body.diarize]);
  if (replay(state, res, key, params)) {
    return;
  }

  if (refuseMinutes(state, res)) {
    return;
  }

  const job = addJob(state, {
    status: 'awaiting_upload',
    platform: 'upload',
    url: '',
    videoId: '',
    title: '',
    filename,
    size,
    source: body.source,
    language: body.language,
    diarize: body.diarize,
    idempotencyKey: key,
    params,
    token: '',
    chunks: planChunks(size, state.knobs.chunkSize),
    received: new Set(),
    data: undefined,
    polls: 0,
    charged: 0,
    errorCode: undefined,
    completedAt: undefined,
  });
  issueToken(state, job);
  writeCreated(state, res, job, false);
};
