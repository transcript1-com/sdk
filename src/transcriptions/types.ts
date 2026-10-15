import type { ProgressEvent, Status, Transcription } from '../types.js';

export type WaitOptionsType = {
  includeWords?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  transcription?: Transcription;
};

export type GetOptions = Omit<WaitOptionsType, 'transcription'> & {
  wait?: boolean;
};

export type ListParams = {
  status?: Status;
  platform?: 'youtube' | 'upload';
  limit?: number;
  signal?: AbortSignal;
};

export type ListPageType<Item> = {
  object: 'list';
  data: Item[];
  next_cursor: string | null;
};
