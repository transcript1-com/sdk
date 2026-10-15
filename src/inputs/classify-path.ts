import type { Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { buildInvalidInputError } from './invalid-input.js';
import { createPathSource } from './path-source.js';
import type { ClassifyOptionsType, FileInputType } from './types.js';
import { validateFile } from './validate-file.js';

const statPath = async (raw: string, resolved: string): Promise<Stats> => {
  try {
    return await stat(resolved);
  } catch (error: unknown) {
    const { code } = (error as NodeJS.ErrnoException);
    if (['ENOENT', 'ENOTDIR'].includes(code ?? '')) {
      throw buildInvalidInputError(`${raw}: no such file`);
    }

    throw buildInvalidInputError(`${raw}: cannot read the file (${code ?? 'unknown error'})`);
  }
};

export const classifyPath = async (raw: string, options: ClassifyOptionsType): Promise<FileInputType> => {
  const resolved = path.resolve(raw);
  const stats = await statPath(raw, resolved);
  if (stats.isDirectory()) {
    throw buildInvalidInputError(`${raw}: is a folder, pass a file`);
  }

  if (!stats.isFile()) {
    throw buildInvalidInputError(`${raw}: not a regular file`);
  }

  const filename = options.filename ?? path.basename(resolved);
  const mimeType = validateFile(filename, stats.size, options.size);

  return {
    kind: 'file',
    filename,
    size: stats.size,
    mimeType,
    source: createPathSource(filename, resolved),
  };
};
