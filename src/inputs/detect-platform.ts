import { isYoutubeHost } from './parse-youtube.js';
import type { LinkPlatformType } from './types.js';

const PLATFORM_HOSTS: Array<{ platform: LinkPlatformType; hosts: string[] }> = [
  {
    platform: 'x',
    hosts: ['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'],
  },
  {
    platform: 'tiktok',
    hosts: ['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com'],
  },
  {
    platform: 'instagram',
    hosts: ['instagram.com', 'www.instagram.com', 'm.instagram.com'],
  },
  {
    platform: 'facebook',
    hosts: [
      'facebook.com',
      'www.facebook.com',
      'm.facebook.com',
      'web.facebook.com',
      'mbasic.facebook.com',
      'fb.watch',
    ],
  },
  {
    platform: 'bluesky',
    hosts: ['bsky.app'],
  },
];

export const detectLinkPlatform = (raw: string): LinkPlatformType | null => {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (isYoutubeHost(host)) {
    return 'youtube';
  }

  const match = PLATFORM_HOSTS.find(entry => entry.hosts.includes(host));
  if (!match) {
    return null;
  }

  return match.platform;
};
