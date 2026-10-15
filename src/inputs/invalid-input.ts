import { ERROR_CODES } from '../codes.js';
import { Transcript1Error } from '../errors.js';

export const buildInvalidInputError = (message: string): Transcript1Error => new Transcript1Error(ERROR_CODES.invalid_input, message);

export const buildFileChangedError = (name: string): Transcript1Error => buildInvalidInputError(`${name}: the file changed while uploading`);
