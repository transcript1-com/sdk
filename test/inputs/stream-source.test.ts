import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { Transcript1Error } from '../../src/errors.js';
import { createStreamSource } from '../../src/inputs/stream-source.js';
import {
  assertInvalidInput,
  buildSequence,
  createStream,
  generateChunks,
} from './helpers.js';

const data = buildSequence(100);

test('splits pieces that straddle chunk boundaries into the requested sizes', async () => {
  const source = createStreamSource('talk.mp3', generateChunks(data, 7), 100);

  assert.deepEqual(await source.read(0, 40), data.subarray(0, 40));
  assert.deepEqual(await source.read(40, 40), data.subarray(40, 80));
  assert.deepEqual(await source.read(80, 20), data.subarray(80));
  await source.close();
});

test('joins one big piece into several chunks', async () => {
  const source = createStreamSource('talk.mp3', createStream([data]), 100);

  assert.deepEqual(await source.read(0, 30), data.subarray(0, 30));
  assert.deepEqual(await source.read(30, 70), data.subarray(30));
  await source.close();
});

test('skips empty pieces', async () => {
  const source = createStreamSource('talk.mp3', createStream([new Uint8Array(), data.subarray(0, 50), new Uint8Array(), data.subarray(50)]), 100);

  assert.deepEqual(await source.read(0, 100), data);
  await source.close();
});

test('reads a Node Readable', async () => {
  const source = createStreamSource('talk.mp3', Readable.from(generateChunks(data, 13)), 100);

  assert.deepEqual(await source.read(0, 60), data.subarray(0, 60));
  assert.deepEqual(await source.read(60, 40), data.subarray(60));
  await source.close();
});

test('is sequential', () => {
  assert.equal(createStreamSource('talk.mp3', createStream([data]), 100).sequential, true);
});

test('errors when the stream ends before the declared size', async () => {
  const source = createStreamSource('talk.mp3', createStream([data.subarray(0, 70)]), 100);

  assert.deepEqual(await source.read(0, 50), data.subarray(0, 50));
  await assertInvalidInput(async () => source.read(50, 50), 'talk.mp3: the stream ended before 100 bytes');
  await source.close();
});

test('errors when the stream is longer than the declared size', async () => {
  const source = createStreamSource('talk.mp3', createStream([buildSequence(101)]), 100);

  assert.deepEqual(await source.read(0, 50), data.subarray(0, 50));
  await assertInvalidInput(async () => source.read(50, 50), 'talk.mp3: the stream is longer than 100 bytes');
  await source.close();
});

test('finds extra data that arrives in a later piece', async () => {
  const source = createStreamSource('talk.mp3', generateChunks(buildSequence(110), 50), 100);

  await assertInvalidInput(async () => source.read(0, 100), 'talk.mp3: the stream is longer than 100 bytes');
  await source.close();
});

test('accepts a stream that has exactly the declared size', async () => {
  const source = createStreamSource('talk.mp3', generateChunks(data, 30), 100);

  assert.deepEqual(await source.read(0, 100), data);
  await source.close();
});

test('fails with a plain error when a read skips ahead', async () => {
  const source = createStreamSource('talk.mp3', createStream([data]), 100);

  await assert.rejects(async () => source.read(10, 10), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.ok(!(error instanceof Transcript1Error));
    return true;
  });
  await source.close();
});

test('fails with a plain error when a chunk is read twice', async () => {
  const source = createStreamSource('talk.mp3', createStream([data]), 100);

  await source.read(0, 50);
  await assert.rejects(async () => source.read(0, 50), /contiguous/);
  await source.close();
});

test('keeps concurrent reads in order', async () => {
  const source = createStreamSource('talk.mp3', generateChunks(data, 9), 100);
  const [first, second] = await Promise.all([source.read(0, 50), source.read(50, 50)]);

  assert.deepEqual(first, data.subarray(0, 50));
  assert.deepEqual(second, data.subarray(50));
  await source.close();
});

test('cancels a web stream when closed', async () => {
  let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(10));
    },
    cancel() {
      canceled += 1;
    },
  });
  const source = createStreamSource('talk.mp3', stream, 100);

  await source.read(0, 10);
  await source.close();
  await source.close();
  assert.equal(canceled, 1);
});

test('stops an async generator when closed', async () => {
  let finished = false;
  const generate = async function * (): AsyncGenerator<Uint8Array> {
    try {
      while (true) {
        yield new Uint8Array(10);
      }
    } finally {
      finished = true;
    }
  };

  const source = createStreamSource('talk.mp3', generate(), 100);

  await source.read(0, 10);
  await source.close();
  assert.equal(finished, true);
});

test('closes a stream that was never read', async () => {
  const readable = Readable.from([data]);
  const source = createStreamSource('talk.mp3', readable, 100);

  await source.close();
  assert.equal(readable.destroyed, true);
});

test('passes on an error of the stream itself', async () => {
  const failing = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error('socket hang up');
    },
  });
  const source = createStreamSource('talk.mp3', failing, 100);

  await assert.rejects(async () => source.read(0, 10), /socket hang up/);
  await source.close();
});
