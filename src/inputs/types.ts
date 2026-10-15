export type ChunkSourceType = {
  sequential: boolean;
  read(offset: number, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
};

export type LinkInputType = {
  kind: 'link';
  url: string;
  videoId: string;
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
