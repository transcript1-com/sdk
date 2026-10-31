import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import type { TranslateResult } from '../types.js';
import { transcriptionPath } from './path.js';

export const translate = async (config: ConfigType, id: string, language: string, signal?: AbortSignal): Promise<TranslateResult> => {
  const response = await request(config, {
    method: 'POST',
    path: `${transcriptionPath(id)}/translations`,
    body: { language },
    signal,
  });

  return response.json as TranslateResult;
};
