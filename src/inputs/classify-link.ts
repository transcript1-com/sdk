import { buildInvalidInputError } from './invalid-input.js';
import { parseYoutube } from './parse-youtube.js';
import type { LinkInputType } from './types.js';

export const classifyLink = (raw: string): LinkInputType => {
  const video = parseYoutube(raw);
  if (!video) {
    throw buildInvalidInputError('Only YouTube links and files are supported for now');
  }

  return {
    kind: 'link',
    url: video.canonicalUrl,
    videoId: video.videoId,
  };
};
