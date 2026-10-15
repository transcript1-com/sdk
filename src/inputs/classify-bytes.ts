import { createBytesSource } from './bytes-source.js';
import { pickFilename } from './pick-filename.js';
import type { ClassifyOptionsType, FileInputType } from './types.js';
import { validateFile } from './validate-file.js';

export const classifyBytes = (input: Uint8Array, options: ClassifyOptionsType): FileInputType => {
  const filename = pickFilename(input, options.filename);
  const mimeType = validateFile(filename, input.byteLength, options.size);

  return {
    kind: 'file',
    filename,
    size: input.byteLength,
    mimeType,
    source: createBytesSource(filename, input),
  };
};
