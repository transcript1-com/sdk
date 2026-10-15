import type { ConfigType } from '../config.js';
import { request } from '../http/request.js';
import { buildInvalidInputError } from '../inputs/invalid-input.js';
import type { TranscriptionSummary } from '../types.js';
import type { ListPageType, ListParams } from './types.js';

const MAX_LIMIT = 100;

const readPages = async function * (config: ConfigType, params: ListParams): AsyncGenerator<TranscriptionSummary> {
  let cursor: string | undefined;
  do {
    // eslint-disable-next-line no-await-in-loop
    const response = await request(config, {
      method: 'GET',
      path: '/v1/transcriptions',
      query: {
        status: params.status,
        platform: params.platform,
        limit: params.limit,
        cursor,
      },
      signal: params.signal,
    });
    const page = response.json as ListPageType<TranscriptionSummary>;
    yield * page.data;
    cursor = page.next_cursor ?? undefined;
  } while (cursor);
};

const validateLimit = (limit: number | undefined) => {
  if (limit === undefined) {
    return;
  }

  if (!Number.isInteger(limit)) {
    throw buildInvalidInputError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }

  if (limit < 1) {
    throw buildInvalidInputError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }

  if (limit > MAX_LIMIT) {
    throw buildInvalidInputError(`limit must be an integer from 1 to ${MAX_LIMIT}`);
  }
};

export const list = (config: ConfigType, params: ListParams = {}): AsyncGenerator<TranscriptionSummary> => {
  validateLimit(params.limit);

  return readPages(config, params);
};
