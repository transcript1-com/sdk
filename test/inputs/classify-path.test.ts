import assert from 'node:assert/strict';
import { truncate } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';
import { classify } from '../../src/inputs/classify.js';
import {
  assertInvalidInput,
  buildSequence,
  makeTempDir,
  writeTempFile,
} from './helpers.js';

const directory = await makeTempDir();

test('reads the size of a file from the disk', async () => {
  const file = await writeTempFile(directory, 'talk.mp3', buildSequence(1234));
  const input = await classify(file, {});

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'talk.mp3');
  assert.equal(input.size, 1234);
  assert.equal(input.mimeType, 'audio/mpeg');
  assert.equal(input.source.sequential, false);
  await input.source.close();
});

test('names a path with spaces and non-ASCII characters by its base name', async () => {
  const file = await writeTempFile(directory, 'Interview Ünal.m4a', buildSequence(10));
  const input = await classify(file, {});

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'Interview Ünal.m4a');
  assert.equal(input.mimeType, 'audio/mp4');
  await input.source.close();
});

test('lets options.filename win over the base name', async () => {
  const file = await writeTempFile(directory, 'recording.bin', buildSequence(10));
  const input = await classify(file, { filename: 'Board Meeting.MP3' });

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'Board Meeting.MP3');
  assert.equal(input.mimeType, 'audio/mpeg');
  await input.source.close();
});

test('checks the extension of the final filename', async () => {
  const file = await writeTempFile(directory, 'talk.mp3', buildSequence(10));

  await assertInvalidInput(
    async () => classify(file, { filename: 'talk.txt' }),
    'talk.txt: unsupported file type (use mp3, wav, m4a, flac, ogg, opus, mp4, mov, webm or mkv)',
  );
});

test('refuses a file with an unsupported extension', async () => {
  const file = await writeTempFile(directory, 'notes.txt', buildSequence(10));

  await assertInvalidInput(
    async () => classify(file, {}),
    'notes.txt: unsupported file type (use mp3, wav, m4a, flac, ogg, opus, mp4, mov, webm or mkv)',
  );
});

test('resolves a relative path against the working directory', async () => {
  const file = await writeTempFile(directory, 'relative/clip.wav', buildSequence(5));
  const input = await classify(path.relative(process.cwd(), file), {});

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'clip.wav');
  assert.equal(input.size, 5);
  await input.source.close();
});

test('names a missing path', async () => {
  const missing = path.join(directory, 'missing.mp3');

  await assertInvalidInput(async () => classify(missing, {}), `${missing}: no such file`);
});

test('refuses a folder', async () => {
  await assertInvalidInput(async () => classify(directory, {}), `${directory}: is a folder, pass a file`);
});

test('refuses an empty file', async () => {
  const file = await writeTempFile(directory, 'empty.mp3', '');

  await assertInvalidInput(async () => classify(file, {}), 'empty.mp3: empty file');
});

test('refuses a file over 2 GB without reading it', async () => {
  const file = await writeTempFile(directory, 'huge.mkv', '');
  await truncate(file, 2_000_000_001);

  await assertInvalidInput(async () => classify(file, {}), 'huge.mkv: larger than 2 GB (2,000,000,000 bytes)');
});

test('accepts a file of exactly 2 GB', async () => {
  const file = await writeTempFile(directory, 'limit.mkv', '');
  await truncate(file, 2_000_000_000);
  const input = await classify(file, {});

  assert.ok(input.kind === 'file');
  assert.equal(input.size, 2_000_000_000);
  await input.source.close();
});

test('refuses an options.size that differs from the file size', async () => {
  const file = await writeTempFile(directory, 'sized.mp3', buildSequence(10));

  await assertInvalidInput(async () => classify(file, { size: 11 }), 'sized.mp3: options.size is 11 but the file is 10 bytes');
});

test('accepts an options.size equal to the file size', async () => {
  const file = await writeTempFile(directory, 'same.mp3', buildSequence(10));
  const input = await classify(file, { size: 10 });

  assert.ok(input.kind === 'file');
  await input.source.close();
});
