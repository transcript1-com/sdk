import type { TranslationOption } from '../types.js';

export type TranslationQueryType = {
  translation: string;
  translation_language?: string;
};

export const buildTranslationQuery = (option: TranslationOption | undefined): TranslationQueryType => {
  if (!option) {
    return { translation: 'none' };
  }

  return { translation: option.mode, translation_language: option.language };
};
