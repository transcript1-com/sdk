import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { classify } from '../../src/inputs/classify.js';
import {
  assertInvalidInput,
  buildSequence,
  createStream,
  generateChunks,
} from './helpers.js';

const NO_NAME = 'pass options.filename for a Buffer, Blob or stream';

test('classifies a Uint8Array with a filename', async () => {
  const input = await classify(buildSequence(100), { filename: 'talk.flac' });

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'talk.flac');
  assert.equal(input.size, 100);
  assert.equal(input.mimeType, 'audio/flac');
  assert.equal(input.source.sequential, false);
});

test('classifies a Buffer like a Uint8Array', async () => {
  const input = await classify(Buffer.alloc(7), { filename: 'talk.wav' });

  assert.ok(input.kind === 'file');
  assert.equal(input.size, 7);
});

test('asks for a filename for a Uint8Array', async () => {
  await assertInvalidInput(async () => classify(buildSequence(10), {}), NO_NAME);
});

test('asks for a filename for a Blob', async () => {
  await assertInvalidInput(async () => classify(new Blob([buildSequence(10)]), {}), NO_NAME);
});

test('uses the name of a File', async () => {
  const input = await classify(new File([buildSequence(10)], 'Ünal talk.opus'), {});

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'Ünal talk.opus');
  assert.equal(input.size, 10);
  assert.equal(input.mimeType, 'audio/opus');
});

test('lets options.filename win over the name of a File', async () => {
  const input = await classify(new File([buildSequence(10)], 'upload.bin'), { filename: 'talk.webm' });

  assert.ok(input.kind === 'file');
  assert.equal(input.filename, 'talk.webm');
  assert.equal(input.mimeType, 'video/webm');
});

test('classifies a Blob with a filename', async () => {
  const input = await classify(new Blob([buildSequence(33)]), { filename: 'clip.mov' });

  assert.ok(input.kind === 'file');
  assert.equal(input.size, 33);
  assert.equal(input.mimeType, 'video/quicktime');
});

test('refuses a bad extension on bytes', async () => {
  await assertInvalidInput(
    async () => classify(buildSequence(10), { filename: 'talk.pdf' }),
    'talk.pdf: unsupported file type (use mp3, wav, m4a, flac, ogg, opus, mp4, mov, webm or mkv)',
  );
});

test('refuses empty bytes', async () => {
  await assertInvalidInput(async () => classify(new Uint8Array(), { filename: 'talk.mp3' }), 'talk.mp3: empty file');
});

test('refuses an options.size that differs from the bytes', async () => {
  await assertInvalidInput(
    async () => classify(buildSequence(10), { filename: 'talk.mp3', size: 9 }),
    'talk.mp3: options.size is 9 but the file is 10 bytes',
  );
});

test('refuses an options.size that differs from the Blob', async () => {
  await assertInvalidInput(
    async () => classify(new Blob([buildSequence(10)]), { filename: 'talk.mp3', size: 11 }),
    'talk.mp3: options.size is 11 but the file is 10 bytes',
  );
});

test('classifies a web stream with a filename and a size', async () => {
  const input = await classify(createStream([buildSequence(10)]), { filename: 'talk.ogg', size: 10 });

  assert.ok(input.kind === 'file');
  assert.equal(input.size, 10);
  assert.equal(input.mimeType, 'audio/ogg');
  assert.equal(input.source.sequential, true);
  await input.source.close();
});

test('classifies a Node Readable and an async generator as streams', async () => {
  const readable = await classify(Readable.from([buildSequence(10)]), { filename: 'talk.mp3', size: 10 });
  const generator = await classify(generateChunks(buildSequence(10), 4), { filename: 'talk.mp3', size: 10 });

  assert.ok(readable.kind === 'file');
  assert.ok(generator.kind === 'file');
  assert.equal(readable.source.sequential, true);
  assert.equal(generator.source.sequential, true);
  await readable.source.close();
  await generator.source.close();
});

test('asks for a filename for a stream', async () => {
  await assertInvalidInput(async () => classify(createStream([buildSequence(10)]), { size: 10 }), NO_NAME);
});

test('asks for a size for a stream', async () => {
  await assertInvalidInput(async () => classify(createStream([buildSequence(10)]), { filename: 'talk.mp3' }), 'pass options.size for a stream');
});

test('asks for a positive whole size for a stream', async () => {
  for (const size of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    // eslint-disable-next-line no-await-in-loop
    await assertInvalidInput(async () => classify(createStream([buildSequence(10)]), { filename: 'talk.mp3', size }), 'pass options.size for a stream');
  }
});

test('refuses a stream declared over 2 GB', async () => {
  await assertInvalidInput(
    async () => classify(createStream([buildSequence(10)]), { filename: 'huge.mp4', size: 2_000_000_001 }),
    'huge.mp4: larger than 2 GB (2,000,000,000 bytes)',
  );
});

test('accepts a stream declared at exactly 2 GB without reading it', async () => {
  const input = await classify(createStream([buildSequence(10)]), { filename: 'limit.mp4', size: 2_000_000_000 });

  assert.ok(input.kind === 'file');
  assert.equal(input.size, 2_000_000_000);
  await input.source.close();
});

test('refuses a value that is not an input', async () => {
  await assertInvalidInput(async () => classify(42 as never, { filename: 'talk.mp3' }), /^Unsupported input: pass a YouTube link/);
});
