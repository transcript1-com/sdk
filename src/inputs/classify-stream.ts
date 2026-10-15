import { buildInvalidInputError } from './invalid-input.js';
import { pickFilename } from './pick-filename.js';
import type { StreamInputType } from './stream-pieces.js';
import { createStreamSource } from './stream-source.js';
import type { ClassifyOptionsType, FileInputType } from './types.js';
import { validateFile } from './validate-file.js';

const pickSize = (size: number | undefined): number => {
  if (size === undefined) {
    throw buildInvalidInputError('pass options.size for a stream');
  }

  if (!Number.isInteger(size)) {
    throw buildInvalidInputError('pass options.size for a stream');
  }

  if (size <= 0) {
    throw buildInvalidInputError('pass options.size for a stream');
  }

  return size;
};

export const classifyStream = (input: StreamInputType, options: ClassifyOptionsType): FileInputType => {
  const filename = pickFilename(input, options.filename);
  const size = pickSize(options.size);
  const mimeType = validateFile(filename, size);

  return {
    kind: 'file',
    filename,
    size,
    mimeType,
    source: createStreamSource(filename, input, size),
  };
};
