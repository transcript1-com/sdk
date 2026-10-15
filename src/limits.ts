export const MAX_UPLOAD_BYTES = 2_000_000_000;
export const MAX_UPLOAD_TEXT = '2 GB (2,000,000,000 bytes)';
export const CHUNK_PUTS_IN_FLIGHT = 4;
export const TOKEN_RENEWALS_PER_CHUNK = 2;

export const MIME_TYPES: Readonly<Record<string, string>> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

export const EXTENSIONS = Object.keys(MIME_TYPES);
