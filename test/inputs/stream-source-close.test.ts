import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { createStreamSource } from '../../src/inputs/stream-source.js';

const PROMPT_MS = 200;

const waitForever = async (): Promise<never> => new Promise<never>(() => {
  // never settles
});

const finishWithin = async (promise: Promise<unknown>, label: string): Promise<void> => {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} did not finish within ${PROMPT_MS} ms`));
    }, PROMPT_MS);
  });
  try {
    await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

test('closes a Node Readable that stalls while a read is waiting', async () => {
  const readable = new Readable({
    read() {
      // stalls after the first 5 bytes
    },
  });
  readable.push(new Uint8Array(5));
  readable.on('error', () => undefined);
  const source = createStreamSource('talk.mp3', readable, 10);
  const pending = source.read(0, 10);
  const outcome = assert.rejects(pending);
  await new Promise(resolve => {
    setImmediate(resolve);
  });

  await finishWithin(source.close(), 'close');
  await finishWithin(outcome, 'the pending read');
  assert.equal(readable.destroyed, true);
});

test('closes a stalled web stream and cancels it', async () => {
  let canceled = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull() {
      return waitForever();
    },
    cancel() {
      canceled += 1;
    },
  });
  const source = createStreamSource('talk.mp3', stream, 10);
  const outcome = assert.rejects(source.read(0, 10));
  await new Promise(resolve => {
    setImmediate(resolve);
  });

  await finishWithin(source.close(), 'close');
  await finishWithin(outcome, 'the pending read');
  assert.equal(canceled, 1);
});

test('closes a stalled async generator', async () => {
  const stalled = async function * (): AsyncGenerator<Uint8Array> {
    yield new Uint8Array(5);
    await waitForever();
  };

  const source = createStreamSource('talk.mp3', stalled(), 10);
  const outcome = assert.rejects(source.read(0, 10));
  await new Promise(resolve => {
    setImmediate(resolve);
  });

  await finishWithin(source.close(), 'close');
  await finishWithin(outcome, 'the pending read');
});

test('rejects a read that is queued behind a stalled one when closed', async () => {
  const stalled = async function * (): AsyncGenerator<Uint8Array> {
    await waitForever();
    yield new Uint8Array(1);
  };

  const source = createStreamSource('talk.mp3', stalled(), 20);
  const first = assert.rejects(source.read(0, 10));
  const second = assert.rejects(source.read(10, 10));
  await new Promise(resolve => {
    setImmediate(resolve);
  });

  await finishWithin(source.close(), 'close');
  await finishWithin(Promise.all([first, second]), 'the pending reads');
});
