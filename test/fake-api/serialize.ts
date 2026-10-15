import type {
  Format,
  Segment,
  Transcript,
  Transcription,
  TranscriptionSummary,
} from '../../src/types.js';
import type { JobType, StateType } from './state.js';

type RenderFormatType = Exclude<Format, 'json'>;

const SEGMENTS = [
  {
    start: 0,
    end: 3.2,
    speaker: 'Speaker 1',
    text: 'Welcome to the show.',
  },
  {
    start: 3.2,
    end: 7.5,
    speaker: 'Speaker 2',
    text: 'Thanks for having me.',
  },
];

const buildSegments = (job: JobType): Segment[] => {
  const segments: Segment[] = [];
  for (const segment of SEGMENTS) {
    const built: Segment = {
      ...segment,
      speaker: null,
      language: 'en',
    };
    if (job.diarize) {
      built.speaker = segment.speaker;
    }

    segments.push(built);
  }

  return segments;
};

export const buildTranscript = (job: JobType): Transcript => {
  const segments = buildSegments(job);
  let speakers: string[] = [];
  if (job.diarize) {
    speakers = SEGMENTS.map(segment => segment.speaker);
  }

  return {
    text: segments.map(segment => segment.text).join(' '),
    speakers,
    segments,
  };
};

const buildSource = (job: JobType): TranscriptionSummary['source'] => {
  if (job.platform === 'youtube') {
    return { platform: 'youtube', url: job.url, media_id: job.videoId };
  }

  return { platform: 'upload', filename: job.filename, size: job.size };
};

const buildMedia = (state: StateType, job: JobType): TranscriptionSummary['media'] => {
  if (job.platform !== 'youtube') {
    return null;
  }

  return { title: job.title, duration_seconds: 60 * state.knobs.minutesPerJob };
};

const buildError = (job: JobType): TranscriptionSummary['error'] => {
  if (!job.errorCode) {
    return null;
  }

  return { code: job.errorCode, message: `The job failed with ${job.errorCode}` };
};

const usesCaptions = (job: JobType): boolean => {
  if (job.platform !== 'youtube') {
    return false;
  }

  if (job.source === 'stt') {
    return false;
  }

  return !job.diarize;
};

export const serialize = (state: StateType, job: JobType, withTranscript: boolean): Transcription | TranscriptionSummary => {
  const summary: TranscriptionSummary = {
    id: job.id,
    object: 'transcription',
    status: job.status,
    source: buildSource(job),
    media: buildMedia(state, job),
    options: {
      source: job.source,
      language: job.language,
      diarize: job.diarize,
    },
    transcript_source: null,
    caption_kind: null,
    language: null,
    billed_minutes: null,
    cached: false,
    error: buildError(job),
    created_at: job.createdAt.toISOString(),
    completed_at: job.completedAt?.toISOString() ?? null,
  };
  if (job.status !== 'completed') {
    return summary;
  }

  summary.transcript_source = 'speech_to_text';
  summary.language = 'en';
  summary.billed_minutes = job.charged;
  if (usesCaptions(job)) {
    summary.transcript_source = 'youtube_captions';
    summary.caption_kind = 'auto_generated';
  }

  if (!withTranscript) {
    return summary;
  }

  return { ...summary, transcript: buildTranscript(job) };
};

const formatClock = (seconds: number): string => {
  const total = Math.floor(seconds);
  const parts = [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60];

  return parts.map(part => String(part).padStart(2, '0')).join(':');
};

const formatCueTime = (seconds: number, separator: string): string => {
  const millis = String(Math.round(seconds * 1000) % 1000).padStart(3, '0');

  return `${formatClock(seconds)}${separator}${millis}`;
};

const buildSpeakerPrefix = (segment: Segment): string => {
  if (!segment.speaker) {
    return '';
  }

  return `${segment.speaker}: `;
};

const buildVoiceTag = (segment: Segment): string => {
  if (!segment.speaker) {
    return '';
  }

  return `<v ${segment.speaker}>`;
};

const buildSrtCue = (segment: Segment, index: number): string => {
  const time = `${formatCueTime(segment.start, ',')} --> ${formatCueTime(segment.end, ',')}`;

  return `${index + 1}\n${time}\n${buildSpeakerPrefix(segment)}${segment.text}\n`;
};

const buildVttCue = (segment: Segment): string => {
  const time = `${formatCueTime(segment.start, '.')} --> ${formatCueTime(segment.end, '.')}`;

  return `${time}\n${buildVoiceTag(segment)}${segment.text}\n`;
};

const buildTextLine = (segment: Segment, timestamps: boolean): string => {
  let time = '';
  if (timestamps) {
    time = `[${formatClock(segment.start)}] `;
  }

  return `${time}${buildSpeakerPrefix(segment)}${segment.text}\n`;
};

export const CONTENT_TYPES: Record<RenderFormatType, string> = {
  text: 'text/plain; charset=utf-8',
  srt: 'application/x-subrip; charset=utf-8',
  vtt: 'text/vtt; charset=utf-8',
};

export const render = (job: JobType, format: RenderFormatType, timestamps: boolean): string => {
  const segments = buildSegments(job);
  if (format === 'srt') {
    return segments.map((segment, index) => buildSrtCue(segment, index)).join('\n');
  }

  if (format === 'vtt') {
    const cues = segments.map(segment => buildVttCue(segment));
    return `WEBVTT\n\n${cues.join('\n')}`;
  }

  return segments.map(segment => buildTextLine(segment, timestamps)).join('');
};
