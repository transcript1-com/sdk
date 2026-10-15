import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after } from 'node:test';
import { Transcript1Error } from '../../src/errors.js';

export const makeTempDir = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'transcript1-sdk-'));
  after(async () => rm(directory, { recursive: true, force: true }));

  return directory;
};

export const writeTempFile = async (directory: string, name: string, content: Uint8Array | string): Promise<string> => {
  const target = path.join(directory, name);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);

  return target;
};

export const buildSequence = (length: number): Uint8Array<ArrayBuffer> => Uint8Array.from({ length }, (_, index) => index % 251);

export const generateChunks = async function * (bytes: Uint8Array, pieceSize: number): AsyncGenerator<Uint8Array> {
  for (let offset = 0; offset < bytes.byteLength; offset += pieceSize) {
    yield bytes.subarray(offset, offset + pieceSize);
  }
};

export const createStream = (pieces: Uint8Array[]): ReadableStream<Uint8Array> => new ReadableStream({
  start(controller) {
    for (const piece of pieces) {
      controller.enqueue(piece);
    }

    controller.close();
  },
});

export const assertInvalidInput = async (action: () => Promise<unknown>, message: string | RegExp): Promise<void> => {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Transcript1Error, 'expected a Transcript1Error');
    assert.equal(error.code, 'invalid_input');
    if (typeof message === 'string') {
      assert.equal(error.message, message);
      return true;
    }

    assert.match(error.message, message);

    return true;
  });
};
