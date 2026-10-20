import type { Transcription } from '../../src/types.js';

const SOURCES: Readonly<Record<string, NonNullable<Transcription['transcript_source']>>> = {
  youtube: 'youtube_captions',
  x: 'x_captions',
  tiktok: 'tiktok_captions',
  bluesky: 'bluesky_captions',
  dailymotion: 'dailymotion_captions',
  linkedin: 'linkedin_captions',
};

export const captionSource = (platform: string): Transcription['transcript_source'] =>
  Object.hasOwn(SOURCES, platform) ? SOURCES[platform] ?? null : null;
