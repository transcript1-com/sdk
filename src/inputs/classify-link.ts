import { detectLinkPlatform } from './detect-platform.js';
import { buildInvalidInputError } from './invalid-input.js';
import { parseYoutube } from './parse-youtube.js';
import type { LinkInputType } from './types.js';

const UNSUPPORTED_LINK = 'Use a YouTube, X, TikTok, Instagram, Facebook or Bluesky link, or upload a file';

const classifyYoutube = (raw: string): LinkInputType => {
  const video = parseYoutube(raw);
  if (!video) {
    throw buildInvalidInputError(UNSUPPORTED_LINK);
  }

  return {
    kind: 'link',
    url: video.canonicalUrl,
    videoId: video.videoId,
    platform: 'youtube',
  };
};

export const classifyLink = (raw: string): LinkInputType => {
  const platform = detectLinkPlatform(raw);
  if (!platform) {
    throw buildInvalidInputError(UNSUPPORTED_LINK);
  }

  if (platform === 'youtube') {
    return classifyYoutube(raw);
  }

  return {
    kind: 'link',
    url: raw.trim(),
    videoId: null,
    platform,
  };
};
