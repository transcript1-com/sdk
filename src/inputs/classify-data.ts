import { classifyBlob } from './classify-blob.js';
import { classifyBytes } from './classify-bytes.js';
import { classifyStream } from './classify-stream.js';
import { buildInvalidInputError } from './invalid-input.js';
import type { ClassifyOptionsType, FileInputType } from './types.js';

const isAsyncIterable = (input: unknown): input is AsyncIterable<Uint8Array> => {
  if (typeof input !== 'object') {
    return false;
  }

  if (input === null) {
    return false;
  }

  return Symbol.asyncIterator in input;
};

export const classifyData = (input: unknown, options: ClassifyOptionsType): FileInputType => {
  if (input instanceof Uint8Array) {
    return classifyBytes(input, options);
  }

  if (input instanceof Blob) {
    return classifyBlob(input, options);
  }

  if (input instanceof ReadableStream) {
    return classifyStream(input, options);
  }

  if (isAsyncIterable(input)) {
    return classifyStream(input, options);
  }

  throw buildInvalidInputError('Unsupported input: pass a link, a file path, a Uint8Array, a Blob or a stream');
};
