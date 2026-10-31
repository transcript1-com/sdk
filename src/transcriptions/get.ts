import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import type { Transcription } from '../types.js';
import { transcriptionPath } from './path.js';
import type { GetOptions } from './types.js';
import { waitFor } from './wait-for.js';

type QueryType = {
  include?: string;
  translation?: string;
};

const buildQuery = (options: GetOptions): QueryType => {
  const query: QueryType = {};
  if (options.includeWords) {
    query.include = 'words';
  }

  if (options.translation) {
    query.translation = options.translation;
  }

  return query;
};

export const get = async (config: ConfigType, id: string, options: GetOptions = {}): Promise<Transcription> => {
  if (options.wait) {
    return waitFor(config, id, options);
  }

  const response = await request(config, {
    method: 'GET',
    path: transcriptionPath(id),
    query: buildQuery(options),
    signal: options.signal,
  });

  return response.json as Transcription;
};
