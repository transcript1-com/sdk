import { MIME_TYPES } from '../limits.js';

export const getMimeType = (filename: string): string | undefined => {
  const dot = filename.lastIndexOf('.');
  if (dot === -1) {
    return undefined;
  }

  const extension = filename.slice(dot + 1).toLowerCase();
  if (!Object.hasOwn(MIME_TYPES, extension)) {
    return undefined;
  }

  return MIME_TYPES[extension];
};
