export type LiveStartOptions = {
  media?: { url: string; key?: string; title?: string; duration?: number };
  language?: string;
  translateTo?: string;
  diarize?: boolean;
  sampleRate?: number;
  save?: boolean;
  signal?: AbortSignal;
};

export type LiveTranslation = {
  language: string;
  text: string;
  final: boolean;
  // true when the line is already in the target language: the translation is its own text, so show the line once
  sameLanguage?: boolean;
};

export type LiveLine = {
  id: number;
  startMs: number;
  endMs: number;
  speaker: string | null;
  language: string | null;
  text: string;
  final: boolean;
  translation: LiveTranslation | null;
};

export type LiveEndReason =
  | 'client_ended'
  | 'balance_exhausted'
  | 'idle_timeout'
  | 'max_duration'
  | 'disconnected'
  | 'upstream_error'
  | 'internal_error';

export type LiveEndResult = {
  reason: LiveEndReason;
  transcriptionId: string | null;
  minutesCharged: number;
  connectedMs: number;
  audioMs: number;
};

export type LiveEvents = {
  started: {
    groupId?: string;
    sessionId: string;
    transcriptionId: string | null;
    resumed: boolean;
    offsetMs: number;
    // true when the session's language is its translateTo: no line is translated
    sameLanguage?: boolean;
    // true when the server accepts boundary(): present only when true
    captionBoundaries?: boolean;
  };
  line: LiveLine;
  usage: { connectedMs: number; audioMs: number; minutesCharged: number; minutesRemaining: number };
  warning: { code: 'balance_low' | 'audio_dropped' | 'idle_timeout_soon'; message: string };
  reconnecting: { attempt: number };
  reconnected: Record<string, never>;
  ended: LiveEndResult;
  error: { code: string; message: string };
};

export type LiveSession = {
  readonly id: string;
  readonly transcriptionId: string | null;
  readonly lines: readonly LiveLine[];
  on<K extends keyof LiveEvents>(event: K, handler: (payload: LiveEvents[K]) => void): () => void;
  send(audio: Int16Array | Uint8Array | ArrayBuffer): void;
  // Milliseconds on the session audio clock and video timeline, before the corresponding audio.
  position(audioMs: number, mediaMs: number): void;
  // Closes the caption at this time on the session audio clock; false when the server does not support it or the session is ending.
  boundary(audioMs: number): boolean;
  finalize(): void;
  end(): Promise<LiveEndResult>;
};

export type LiveStatus = 'waiting' | 'connected' | 'disconnected' | 'ended';

export type LiveSessionOptions = {
  language: string;
  translateTo: string | null;
  diarize: boolean;
  audioFormat: string;
  sampleRate: number;
  save: boolean;
};

export type LiveSessionInfo = {
  id: string;
  status: LiveStatus;
  endReason: string | null;
  transcriptionId: string | null;
  options: LiveSessionOptions;
  connectedMs: number;
  audioMs: number;
  minutesCharged: number;
  rate: number;
  createdAt: string | null;
  endedAt: string | null;
};

export type LiveTranslationPair = {
  from: string;
  to: string;
};

export type LiveCapabilities =
  | { available: false; rate: number }
  | {
    available: true;
    autoLanguage: boolean;
    languages: string[];
    translation: {
      targets: string[];
      pairs: 'any' | LiveTranslationPair[];
      requiresLanguage: boolean;
    };
    diarize: boolean;
    audioFormats: string[];
    sampleRate: { min: number; max: number };
    maxSessionMinutes: number;
    rate: number;
  };

export type Live = {
  start(options?: LiveStartOptions): Promise<LiveSession>;
  get(id: string, options?: { signal?: AbortSignal }): Promise<LiveSessionInfo>;
  capabilities(options?: { signal?: AbortSignal }): Promise<LiveCapabilities>;
};
