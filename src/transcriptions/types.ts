import type { LinkPlatformType } from '../inputs/types.js';
import type {
  ProgressEvent,
  Status,
  Transcription,
  TranslationOption,
} from '../types.js';

export type WaitOptionsType = {
  includeWords?: boolean;
  translation?: TranslationOption;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
  transcription?: Transcription;
};

export type GetOptions = Omit<WaitOptionsType, 'transcription'> & {
  wait?: boolean;
};

export type ListParams = {
  status?: Status;
  platform?: LinkPlatformType | 'upload';
  limit?: number;
  signal?: AbortSignal;
};

export type ListPageType<Item> = {
  object: 'list';
  data: Item[];
  next_cursor: string | null;
};
