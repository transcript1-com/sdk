import type { ConfigType } from '../config.js';
import type { Transcript1Error } from '../errors.js';
import type { ChunkSourceType, FileInputType } from '../inputs/types.js';
import type { Chunk, ProgressEvent } from '../types.js';

export type CreateBodyType = {
  upload: { filename: string; size: number; mime_type: string };
  language?: string;
  diarize?: boolean;
};

export type UploadOptionsType = {
  idempotencyKey: string;
  body: CreateBodyType;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
  waitSlot: (error: Transcript1Error, signal?: AbortSignal) => Promise<void>;
};

export type UploadType = {
  config: ConfigType;
  file: FileInputType;
  source: ChunkSourceType;
  options: UploadOptionsType;
  id: string;
  template: string;
  chunks: Chunk[];
  token: string;
  generation: number;
  renewing: Promise<void> | undefined;
  received: Set<number>;
  counted: Set<number>;
  sent: number;
};
