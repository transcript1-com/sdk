import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import { transcriptionPath } from './path.js';

export const remove = async (config: ConfigType, id: string, signal?: AbortSignal): Promise<void> => {
  await request(config, { method: 'DELETE', path: transcriptionPath(id), signal });
};
