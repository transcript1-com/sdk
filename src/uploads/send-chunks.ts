import type { ChunkSourceType } from '../inputs/types.js';
import { CHUNK_PUTS_IN_FLIGHT } from '../limits.js';
import type { Chunk } from '../types.js';
import { sendChunk } from './send-chunk.js';
import type { UploadType } from './types.js';
import { buildAbortedUploadError } from './with-job-id.js';

const readChunk = async (source: ChunkSourceType, chunk: Chunk, signal: AbortSignal): Promise<Uint8Array> => {
  // read before any await, so a stream is read in order
  const read = source.read(chunk.offset, chunk.size);
  read.catch(() => null);

  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(buildAbortedUploadError());
      return;
    }

    const onAbort = () => {
      reject(buildAbortedUploadError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    read.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
};

// read before any await, so a stream is read in order
export const sendChunks = async (upload: UploadType, chunks: Chunk[], callerSignal?: AbortSignal): Promise<void> => {
  const controller = new AbortController();
  let { signal } = controller;
  if (callerSignal) {
    signal = AbortSignal.any([callerSignal, controller.signal]);
  }

  let next = 0;
  let failure: { error: unknown } | undefined;

  const runWorker = async (): Promise<void> => {
    while (next < chunks.length) {
      if (failure) {
        return;
      }

      if (signal.aborted) {
        return;
      }

      const chunk = chunks[next]!;
      next++;
      try {
        // eslint-disable-next-line no-await-in-loop
        const data = await readChunk(upload.source, chunk, signal);
        // eslint-disable-next-line no-await-in-loop
        await sendChunk(upload, chunk, data, signal);
      } catch (error: unknown) {
        if (!failure) {
          failure = { error };
        }

        controller.abort();
        return;
      }
    }
  };

  const workerCount = Math.min(CHUNK_PUTS_IN_FLIGHT, chunks.length);
  await Promise.all(Array.from({ length: workerCount }, async () => runWorker()));
  if (callerSignal?.aborted) {
    throw buildAbortedUploadError();
  }

  if (failure) {
    throw failure.error;
  }
};
