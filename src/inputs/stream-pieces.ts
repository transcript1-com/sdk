export type StreamInputType = ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>;

export type PiecesType = {
  next(): Promise<Uint8Array | undefined>;
  cancel(): Promise<void>;
};

const openWebStream = (stream: ReadableStream<Uint8Array>): PiecesType => {
  const reader = stream.getReader();

  return {
    async next() {
      const { done, value } = await reader.read();
      if (done) {
        return undefined;
      }

      return value;
    },
    async cancel() {
      await reader.cancel().catch(() => null);
    },
  };
};

const destroyIterable = (iterable: AsyncIterable<Uint8Array>) => {
  if (!('destroy' in iterable)) {
    return;
  }

  if (typeof iterable.destroy === 'function') {
    iterable.destroy();
  }
};

const openAsyncIterable = (iterable: AsyncIterable<Uint8Array>): PiecesType => {
  const iterator = iterable[Symbol.asyncIterator]();

  return {
    async next() {
      const result = await iterator.next();
      if (result.done) {
        return undefined;
      }

      return result.value;
    },
    async cancel() {
      await iterator.return?.().catch(() => null);
      destroyIterable(iterable);
    },
  };
};

export const openPieces = (input: StreamInputType): PiecesType => {
  if (input instanceof ReadableStream) {
    return openWebStream(input);
  }

  return openAsyncIterable(input);
};
