import { createBlobSource } from './blob-source.js';
import { pickFilename } from './pick-filename.js';
import type { ClassifyOptionsType, FileInputType } from './types.js';
import { validateFile } from './validate-file.js';

export const classifyBlob = (input: Blob, options: ClassifyOptionsType): FileInputType => {
  const filename = pickFilename(input, options.filename);
  const mimeType = validateFile(filename, input.size, options.size);

  return {
    kind: 'file',
    filename,
    size: input.size,
    mimeType,
    source: createBlobSource(filename, input),
  };
};
