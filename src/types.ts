export type Status =
  | 'awaiting_upload'
  | 'queued'
  | 'fetching'
  | 'transcribing'
  | 'completed'
  | 'failed'
  | 'canceled';

export type Format = 'text' | 'srt' | 'vtt' | 'json';

export type Word = {
  start: number;
  end: number;
  text: string;
  confidence?: number | null;
  speaker: string | null;
};

export type Segment = {
  start: number;
  end: number;
  speaker: string | null;
  language: string | null;
  text: string;
  words?: Word[] | null;
};

export type Transcript = {
  text: string;
  speakers: string[];
  segments: Segment[];
};

export type LinkSource = {
  platform: string;
  url: string | null;
  media_id: string | null;
};

export type UploadSource = {
  platform: 'upload';
  filename: string | null;
  size: number | null;
};

export type Media = {
  title?: string | null;
  author?: string | null;
  author_url?: string | null;
  thumbnail_url?: string | null;
  filename?: string;
  mime_type?: string;
  size?: number;
  duration_seconds?: number | null;
};

export type TranscriptionOptions = {
  source: 'auto' | 'captions' | 'stt';
  language: string;
  diarize: boolean;
};

export type JobError = {
  code: string;
  message: string | null;
};

export type Chunk = {
  index: number;
  offset: number;
  size: number;
};

export type UploadPlan = {
  chunk_url_template: string;
  headers: { 'X-Upload-Token': string };
  expires_at: string;
  chunks: Chunk[];
};

export type Transcription = {
  id: string;
  object: 'transcription';
  status: Status;
  source: LinkSource | UploadSource;
  media: Media | null;
  options: TranscriptionOptions;
  transcript_source: 'youtube_captions' | 'speech_to_text' | null;
  caption_kind: 'manual' | 'auto_generated' | null;
  language: string | null;
  billed_minutes: number | null;
  cached: boolean;
  error: JobError | null;
  created_at: string | null;
  completed_at: string | null;
  transcript?: Transcript;
  upload?: UploadPlan;
  reused?: boolean;
};

export type CompletedTranscription = Transcription & {
  status: 'completed';
  transcript: Transcript;
};

export type TranscriptionSummary = Omit<Transcription, 'transcript'>;

export type Account = {
  object: 'account';
  user: { id: string; email: string };
  plan: { id: string; name: string } | null;
  minutes: {
    remaining: number;
    cycle: number;
    topup: number;
    topup_usable: boolean;
    resets_at: string | null;
  };
  renews_at: string | null;
  limits: { requests_per_minute: number; max_active_jobs: number };
};

export type ProgressEvent =
  | { type: 'upload'; sent: number; total: number }
  | { type: 'status'; status: Status }
  | { type: 'waiting_slot'; retryAfter: number }
  | { type: 'reconnecting' };

export type Input = string | Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export type TranscribeOptions = CreateOptions;

export type DownloadOptions = {
  format?: Format;
  timestamps?: boolean;
  signal?: AbortSignal;
};

export type CreateOptions = {
  speakers?: boolean;
  language?: string;
  source?: 'auto' | 'captions' | 'stt';
  fresh?: boolean;
  filename?: string;
  size?: number;
  idempotencyKey?: string;
  onProgress?: (event: ProgressEvent) => void;
  signal?: AbortSignal;
};
