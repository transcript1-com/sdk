import { buildInvalidInputError } from '../inputs/invalid-input.js';

export const transcriptionPath = (id: string): string => {
  if (typeof id !== 'string') {
    throw buildInvalidInputError('A transcription id is required');
  }

  if (!id.trim()) {
    throw buildInvalidInputError('A transcription id is required');
  }

  return `/v1/transcriptions/${encodeURIComponent(id)}`;
};
