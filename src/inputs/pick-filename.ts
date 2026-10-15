import { buildInvalidInputError } from './invalid-input.js';

const getFileName = (input: object): string | undefined => {
  if (input instanceof File) {
    return input.name;
  }

  return undefined;
};

export const pickFilename = (input: object, filename: string | undefined): string => {
  const picked = filename ?? getFileName(input);
  if (!picked) {
    throw buildInvalidInputError('pass options.filename for a Buffer, Blob or stream');
  }

  return picked;
};
