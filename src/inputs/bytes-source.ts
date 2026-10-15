import { buildFileChangedError } from './invalid-input.js';
import type { ChunkSourceType } from './types.js';

export const createBytesSource = (name: string, bytes: Uint8Array): ChunkSourceType => ({
  sequential: false,
  async read(offset, size) {
    const chunk = bytes.subarray(offset, offset + size);
    if (chunk.byteLength < size) {
      throw buildFileChangedError(name);
    }

    return chunk;
  },
  async close() {
    // nothing to release
  },
});
