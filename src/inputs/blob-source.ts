import { buildFileChangedError } from './invalid-input.js';
import type { ChunkSourceType } from './types.js';

export const createBlobSource = (name: string, blob: Blob): ChunkSourceType => ({
  sequential: false,
  async read(offset, size) {
    const chunk = new Uint8Array(await blob.slice(offset, offset + size).arrayBuffer());
    if (chunk.byteLength < size) {
      throw buildFileChangedError(name);
    }

    return chunk;
  },
  async close() {
    // nothing to release
  },
});
