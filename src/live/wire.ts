import type {
  LiveCapabilities,
  LiveEndReason,
  LiveEndResult,
  LiveEvents,
  LiveLine,
  LiveSessionInfo,
  LiveStartOptions,
  LiveStatus,
  LiveTranslationPair,
} from './types.js';

export const LIVE_PROTOCOL = 't1-live';
export const DEFAULT_SAMPLE_RATE = 16_000;
export const MAX_FRAME_BYTES = 262_144;

export type LiveCreated = {
  id: string;
  status: string;
  transcriptionId: string | null;
  websocketUrl: string;
  token: string;
  tokenExpiresAt: string;
  rate: number;
};

export type ServerEvent =
  | { type: 'started'; payload: LiveEvents['started'] }
  | { type: 'line'; payload: LiveLine }
  | { type: 'usage'; payload: LiveEvents['usage'] }
  | { type: 'warning'; payload: LiveEvents['warning'] }
  | { type: 'error'; payload: LiveEvents['error'] }
  | { type: 'reconnect' }
  | { type: 'ended'; payload: LiveEndResult };

type RecordType = Record<string, unknown>;

const WARNING_MESSAGES: Record<LiveEvents['warning']['code'], string> = {
  balance_low: 'Your balance will not cover the next minute of this session',
  audio_dropped: 'Audio sent before the connection was ready was dropped',
  idle_timeout_soon: 'No audio is arriving; the session will end soon',
};

const isRecord = (value: unknown): value is RecordType => {
  if (value === null) {
    return false;
  }

  if (typeof value !== 'object') {
    return false;
  }

  return !Array.isArray(value);
};

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string') {
    return value;
  }

  return fallback;
};

const nullableText = (value: unknown): string | null => {
  if (typeof value === 'string') {
    return value;
  }

  return null;
};

const count = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  return 0;
};

const parseTranslation = (value: unknown): LiveLine['translation'] => {
  if (!isRecord(value)) {
    return null;
  }

  return {
    language: text(value.language),
    text: text(value.text),
    final: value.final === true,
  };
};

export const parseLine = (value: unknown): LiveLine | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (typeof value.id !== 'number') {
    return undefined;
  }

  return {
    id: value.id,
    startMs: count(value.start_ms),
    endMs: count(value.end_ms),
    speaker: nullableText(value.speaker),
    language: nullableText(value.language),
    text: text(value.text),
    final: value.final === true,
    translation: parseTranslation(value.translation),
  };
};

const parseStarted = (message: RecordType): ServerEvent => ({
  type: 'started',
  payload: {
    sessionId: text(message.session_id),
    transcriptionId: nullableText(message.transcription_id),
    resumed: message.resumed === true,
    offsetMs: count(message.offset_ms),
  },
});

const parseUsage = (message: RecordType): ServerEvent => ({
  type: 'usage',
  payload: {
    connectedMs: count(message.connected_ms),
    audioMs: count(message.audio_ms),
    minutesCharged: count(message.minutes_charged),
    minutesRemaining: count(message.minutes_remaining),
  },
});

const parseWarning = (message: RecordType): ServerEvent | undefined => {
  const code = message.code as LiveEvents['warning']['code'];
  if (!Object.hasOwn(WARNING_MESSAGES, code)) {
    return undefined;
  }

  return { type: 'warning', payload: { code, message: WARNING_MESSAGES[code] } };
};

const parseEnded = (message: RecordType): ServerEvent => ({
  type: 'ended',
  payload: {
    reason: text(message.reason, 'internal_error') as LiveEndReason,
    transcriptionId: nullableText(message.transcription_id),
    minutesCharged: count(message.minutes_charged),
    connectedMs: count(message.connected_ms),
    audioMs: count(message.audio_ms),
  },
});

const parseEvent = (message: RecordType): ServerEvent | undefined => {
  switch (message.type) {
    case 'session.started': {
      return parseStarted(message);
    }

    case 'line': {
      const line = parseLine(message.line);
      return line && { type: 'line', payload: line };
    }

    case 'usage': {
      return parseUsage(message);
    }

    case 'warning': {
      return parseWarning(message);
    }

    case 'error': {
      return { type: 'error', payload: { code: text(message.code, 'error'), message: text(message.message) } };
    }

    case 'reconnect': {
      return { type: 'reconnect' };
    }

    case 'session.ended': {
      return parseEnded(message);
    }

    default: {
      return undefined;
    }
  }
};

// anything unreadable or unknown is skipped, so newer servers can add events
export const parseServerEvent = (data: unknown): ServerEvent | undefined => {
  if (typeof data !== 'string') {
    return undefined;
  }

  let message: unknown;
  try {
    message = JSON.parse(data);
  } catch {
    return undefined;
  }

  if (!isRecord(message)) {
    return undefined;
  }

  return parseEvent(message);
};

export const FINALIZE_COMMAND = JSON.stringify({ type: 'finalize' });
export const END_COMMAND = JSON.stringify({ type: 'end' });

export const buildCreateBody = (options: LiveStartOptions): RecordType => {
  const body: RecordType = {};
  if (options.language !== undefined) {
    body.language = options.language;
  }

  if (options.translateTo !== undefined) {
    body.translate_to = options.translateTo;
  }

  if (options.diarize !== undefined) {
    body.diarize = options.diarize;
  }

  if (options.sampleRate !== undefined) {
    body.sample_rate = options.sampleRate;
  }

  if (options.save !== undefined) {
    body.save = options.save;
  }

  return body;
};

export const parseCreated = (value: unknown): LiveCreated => {
  const body = isRecord(value) ? value : {};

  return {
    id: text(body.id),
    status: text(body.status),
    transcriptionId: nullableText(body.transcription_id),
    websocketUrl: text(body.websocket_url),
    token: text(body.token),
    tokenExpiresAt: text(body.token_expires_at),
    rate: count(body.rate),
  };
};

const parseOptions = (value: unknown): LiveSessionInfo['options'] => {
  const options = isRecord(value) ? value : {};

  return {
    language: text(options.language, 'auto'),
    translateTo: nullableText(options.translate_to),
    diarize: options.diarize === true,
    audioFormat: text(options.audio_format, 'pcm_s16le'),
    sampleRate: count(options.sample_rate),
    save: options.save !== false,
  };
};

export const parseSessionInfo = (value: unknown): LiveSessionInfo => {
  const body = isRecord(value) ? value : {};

  return {
    id: text(body.id),
    status: text(body.status) as LiveStatus,
    endReason: nullableText(body.end_reason),
    transcriptionId: nullableText(body.transcription_id),
    options: parseOptions(body.options),
    connectedMs: count(body.connected_ms),
    audioMs: count(body.audio_ms),
    minutesCharged: count(body.minutes_charged),
    rate: count(body.rate),
    createdAt: nullableText(body.created_at),
    endedAt: nullableText(body.ended_at),
  };
};

const strings = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
};

const parsePairs = (value: unknown): 'any' | LiveTranslationPair[] => {
  if (!Array.isArray(value)) {
    return 'any';
  }

  return value.filter(item => isRecord(item)).map(item => ({ from: text(item.from), to: text(item.to) }));
};

export const parseCapabilities = (value: unknown): LiveCapabilities => {
  const body = isRecord(value) ? value : {};
  if (body.available !== true) {
    return { available: false, rate: count(body.rate) };
  }

  const translation = isRecord(body.translation) ? body.translation : {};
  const sampleRate = isRecord(body.sample_rate) ? body.sample_rate : {};

  return {
    available: true,
    autoLanguage: body.auto_language === true,
    languages: strings(body.languages),
    translation: {
      targets: strings(translation.targets),
      pairs: parsePairs(translation.pairs),
      requiresLanguage: translation.requires_language === true,
    },
    diarize: body.diarize === true,
    audioFormats: strings(body.audio_formats),
    sampleRate: { min: count(sampleRate.min), max: count(sampleRate.max) },
    maxSessionMinutes: count(body.max_session_minutes),
    rate: count(body.rate),
  };
};
