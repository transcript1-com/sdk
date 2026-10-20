export type ChunkSourceType = {
  sequential: boolean;
  read(offset: number, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type LinkPlatformType = 'youtube' | 'x' | 'tiktok' | 'instagram' | 'facebook' | 'bluesky'
| 'twitch' | 'dailymotion' | 'pinterest' | 'linkedin' | 'snapchat';

export type LinkInputType = {
  kind: 'link';
  url: string;
  videoId: string | null;
  platform: LinkPlatformType;
};

export type FileInputType = {
  kind: 'file';
  filename: string;
  size: number;
  mimeType: string;
  source: ChunkSourceType;
};

export type ClassifyOptionsType = {
  filename?: string;
  size?: number;
};
