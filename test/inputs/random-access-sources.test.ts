import assert from 'node:assert/strict';
import { rm, truncate } from 'node:fs/promises';
import { test } from 'node:test';
import { createBlobSource } from '../../src/inputs/blob-source.js';
import { createBytesSource } from '../../src/inputs/bytes-source.js';
import { createPathSource } from '../../src/inputs/path-source.js';
import type { ChunkSourceType } from '../../src/inputs/types.js';
import {
  assertInvalidInput,
  buildSequence,
  makeTempDir,
  writeTempFile,
} from './helpers.js';

const directory = await makeTempDir();
const data = buildSequence(1000);

const sources: Array<[string, () => Promise<ChunkSourceType>]> = [
  ['bytes', async () => createBytesSource('talk.mp3', data)],
  ['a Blob', async () => createBlobSource('talk.mp3', new Blob([data]))],
  ['a path', async () => createPathSource('talk.mp3', await writeTempFile(directory, 'read.mp3', data))],
];

for (const [label, open] of sources) {
  test(`reads any range of ${label} in any order`, async () => {
    const source = await open();

    assert.equal(source.sequential, false);
    assert.deepEqual(await source.read(600, 400), data.subarray(600));
    assert.deepEqual(await source.read(0, 250), data.subarray(0, 250));
    assert.deepEqual(await source.read(250, 350), data.subarray(250, 600));
    await source.close();
  });

  test(`refuses a range that runs past the end of ${label}`, async () => {
    const source = await open();

    await assertInvalidInput(async () => source.read(900, 200), 'talk.mp3: the file changed while uploading');
    await source.close();
  });

  test(`closes ${label} more than once`, async () => {
    const source = await open();

    await source.read(0, 10);
    await source.close();
    await source.close();
  });
}

test('notices a file that shrank after it was classified', async () => {
  const file = await writeTempFile(directory, 'shrinks.mp3', data);
  const source = createPathSource('shrinks.mp3', file);
  await truncate(file, 500);

  assert.deepEqual(await source.read(0, 500), data.subarray(0, 500));
  await assertInvalidInput(async () => source.read(400, 200), 'shrinks.mp3: the file changed while uploading');
  await source.close();
});

test('notices a file that was deleted after it was classified', async () => {
  const file = await writeTempFile(directory, 'gone.mp3', data);
  const source = createPathSource('gone.mp3', file);
  await rm(file);

  await assertInvalidInput(async () => source.read(0, 10), 'gone.mp3: the file changed while uploading');
  await source.close();
});

test('does not open a path until it is read', async () => {
  const source = createPathSource('never.mp3', `${directory}/never-created.mp3`);

  await source.close();
});

test('refuses to read a path after it was closed', async () => {
  const file = await writeTempFile(directory, 'closed.mp3', data);
  const source = createPathSource('closed.mp3', file);
  await source.read(0, 10);
  await source.close();

  await assert.rejects(async () => source.read(0, 10), /closed/);
});
