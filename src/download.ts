import { ensureCompleted } from './ensure-completed.js';
import type { ConfigType } from './config.js';
import { request } from './http/request.js';
import { buildInvalidInputError } from './inputs/invalid-input.js';
import { transcriptionPath } from './transcriptions/path.js';
import { waitFor } from './transcriptions/wait-for.js';
import type { DownloadOptions, Format } from './types.js';
import { withJobId } from './uploads/with-job-id.js';

type QueryType = {
  format?: Format;
  timestamps?: boolean;
};

const validateFormat = (options: DownloadOptions): Format => {
  const formats: Format[] = ['text', 'srt', 'vtt', 'json'];
  const format = options.format ?? 'text';
  if (!formats.includes(format)) {
    throw buildInvalidInputError(`format must be one of ${formats.join(', ')}`);
  }

  if (!options.timestamps) {
    return format;
  }

  if (format !== 'text') {
    throw buildInvalidInputError('timestamps only apply to the text format');
  }

  return format;
};

const buildQuery = (format: Format, options: DownloadOptions): QueryType => {
  const query: QueryType = {};
  if (format !== 'json') {
    query.format = format;
  }

  if (options.timestamps) {
    query.timestamps = true;
  }

  return query;
};

// json is the api's own json text
export const download = async (config: ConfigType, id: string, options: DownloadOptions = {}): Promise<string> => {
  const format = validateFormat(options);
  const path = transcriptionPath(id);
  ensureCompleted(await waitFor(config, id, { signal: options.signal }));

  try {
    const response = await request(config, {
      method: 'GET',
      path,
      query: buildQuery(format, options),
      signal: options.signal,
      raw: true,
    });

    return response.text ?? '';
  } catch (error: unknown) {
    throw withJobId(error, id);
  }
};
