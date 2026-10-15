import { open, type FileHandle } from 'node:fs/promises';
import { buildFileChangedError } from './invalid-input.js';
import type { ChunkSourceType } from './types.js';

export const createPathSource = (name: string, filePath: string): ChunkSourceType => {
  let handle: Promise<FileHandle> | undefined;
  let closed = false;

  const openHandle = async (): Promise<FileHandle> => {
    try {
      return await open(filePath, 'r');
    } catch {
      throw buildFileChangedError(name);
    }
  };

  return {
    sequential: false,
    async read(offset, size) {
      if (closed) {
        throw new Error(`${name}: the source is closed`);
      }

      handle = handle ?? openHandle();
      const file = await handle;
      const buffer = new Uint8Array(size);
      let filled = 0;
      while (filled < size) {
        // eslint-disable-next-line no-await-in-loop
        const { bytesRead } = await file.read(buffer, filled, size - filled, offset + filled);
        if (bytesRead === 0) {
          throw buildFileChangedError(name);
        }

        filled += bytesRead;
      }

      return buffer;
    },
    async close() {
      closed = true;
      const pending = handle;
      handle = undefined;
      if (pending) {
        const file = await pending.catch(() => null);
        await file?.close();
      }
    },
  };
};
