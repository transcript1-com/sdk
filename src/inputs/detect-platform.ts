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
  { platform: 'twitch', hosts: ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv', 'clips.twitch.tv'] },
  { platform: 'dailymotion', hosts: ['dailymotion.com', 'www.dailymotion.com', 'touch.dailymotion.com', 'dai.ly'] },
  { platform: 'pinterest', hosts: ['pinterest.com', 'www.pinterest.com'] },
  { platform: 'linkedin', hosts: ['linkedin.com', 'www.linkedin.com'] },
  { platform: 'snapchat', hosts: ['snapchat.com', 'www.snapchat.com'] },
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

  if (['twitch', 'dailymotion', 'pinterest', 'linkedin', 'snapchat'].includes(match.platform)
    && (url.protocol !== 'https:' || url.username || url.password || url.port
      || /^[a-z]+:\/\/[^/]*@/i.test(raw.trim()))) {
    return null;
  }

  return match.platform;
};
