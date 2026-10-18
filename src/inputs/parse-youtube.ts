export type YoutubeVideoType = {
  videoId: string;
  canonicalUrl: string;
};

export const isYoutubeHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().replace(/^www\./, '');

  return ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
};

const isWatchPath = (segments: string[]): boolean => {
  if (segments.length !== 1) {
    return false;
  }

  return segments[0] === 'watch';
};

const isPrefixPath = (segments: string[]): boolean => {
  if (segments.length !== 2) {
    return false;
  }

  return ['shorts', 'embed', 'live'].includes(segments[0] ?? '');
};

const pickVideoId = (host: string, segments: string[], url: URL): string | null => {
  if (host === 'youtu.be') {
    return segments[0] ?? null;
  }

  if (isWatchPath(segments)) {
    return url.searchParams.get('v');
  }

  if (isPrefixPath(segments)) {
    return segments[1] ?? null;
  }

  return null;
};

// same rules as the api parser and the cli
export const parseYoutube = (raw: string): YoutubeVideoType | undefined => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return undefined;
  }

  if (!isYoutubeHost(url.hostname)) {
    return undefined;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');

  const segments = url.pathname.split('/').filter(Boolean);
  const videoId = pickVideoId(host, segments, url);
  if (!videoId) {
    return undefined;
  }

  if (!/^[\w-]{11}$/.test(videoId)) {
    return undefined;
  }

  return { videoId, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}` };
};
