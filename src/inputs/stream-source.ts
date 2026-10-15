import { buildInvalidInputError } from './invalid-input.js';
import { openPieces, type StreamInputType } from './stream-pieces.js';
import type { ChunkSourceType } from './types.js';

const joinParts = (parts: Uint8Array[], size: number): Uint8Array => {
  const joined = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.byteLength;
  }

  return joined;
};

export const createStreamSource = (name: string, input: StreamInputType, total: number): ChunkSourceType => {
  const pieces = openPieces(input);
  const leftover: Uint8Array[] = [];
  let consumed = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  let signalClosed: () => void = () => undefined;
  const whenClosed = new Promise<never>((_, reject) => {
    signalClosed = () => {
      reject(new Error(`${name}: the source is closed`));
    };
  });
  whenClosed.catch(() => null);

  // a stalled stream never answers, closing ends the read
  const pullPiece = async (): Promise<Uint8Array | undefined> => Promise.race([pieces.next(), whenClosed]);

  const readPiece = async (): Promise<Uint8Array | undefined> => {
    const kept = leftover.shift();
    if (kept) {
      return kept;
    }

    let piece = await pullPiece();
    while (piece?.byteLength === 0) {
      // eslint-disable-next-line no-await-in-loop
      piece = await pullPiece();
    }

    return piece;
  };

  const readBytes = async (size: number): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];
    let missing = size;
    while (missing > 0) {
      // eslint-disable-next-line no-await-in-loop
      const piece = await readPiece();
      if (!piece) {
        throw buildInvalidInputError(`${name}: the stream ended before ${total} bytes`);
      }

      parts.push(piece.subarray(0, missing));
      if (piece.byteLength > missing) {
        leftover.unshift(piece.subarray(missing));
      }

      missing -= Math.min(piece.byteLength, missing);
    }

    return joinParts(parts, size);
  };

  const buildContiguousError = (offset: number, size: number) => new Error(`${name}: stream reads must be contiguous (expected offset ${consumed}, got ${offset} with size ${size})`);

  const readChunk = async (offset: number, size: number): Promise<Uint8Array> => {
    if (closed) {
      throw new Error(`${name}: the source is closed`);
    }

    if (offset !== consumed) {
      throw buildContiguousError(offset, size);
    }

    if (offset + size > total) {
      throw buildContiguousError(offset, size);
    }

    const chunk = await readBytes(size);
    consumed += size;
    if (consumed !== total) {
      return chunk;
    }

    if (await readPiece()) {
      throw buildInvalidInputError(`${name}: the stream is longer than ${total} bytes`);
    }

    return chunk;
  };

  return {
    sequential: true,
    async read(offset, size) {
      const run = queue.then(async () => readChunk(offset, size));
      queue = run.catch(() => null);

      return run;
    },
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      signalClosed();
      await pieces.cancel();
    },
  };
};
