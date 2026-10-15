import { EXTENSIONS, MAX_UPLOAD_BYTES, MAX_UPLOAD_TEXT } from '../limits.js';
import { buildInvalidInputError } from './invalid-input.js';
import { getMimeType } from './mime-type.js';

const buildExtensionList = (): string => `${EXTENSIONS.slice(0, -1).join(', ')} or ${EXTENSIONS.at(-1)}`;

const validateDeclaredSize = (filename: string, size: number, declared?: number) => {
  if (declared === undefined) {
    return;
  }

  if (declared !== size) {
    throw buildInvalidInputError(`${filename}: options.size is ${declared} but the file is ${size} bytes`);
  }
};

export const validateFile = (filename: string, size: number, declared?: number): string => {
  const type = getMimeType(filename);
  if (!type) {
    throw buildInvalidInputError(`${filename}: unsupported file type (use ${buildExtensionList()})`);
  }

  validateDeclaredSize(filename, size, declared);
  if (size === 0) {
    throw buildInvalidInputError(`${filename}: empty file`);
  }

  if (size > MAX_UPLOAD_BYTES) {
    throw buildInvalidInputError(`${filename}: larger than ${MAX_UPLOAD_TEXT}`);
  }

  return type;
};
