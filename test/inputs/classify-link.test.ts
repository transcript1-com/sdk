import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classify } from '../../src/inputs/classify.js';
import { assertInvalidInput } from './helpers.js';

const UNSUPPORTED = 'Only YouTube links and files are supported for now';

test('turns a YouTube link into a link input with its canonical url', async () => {
  const input = await classify('https://youtu.be/dQw4w9WgXcQ?si=abc&t=10', {});

  assert.deepEqual(input, {
    kind: 'link',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoId: 'dQw4w9WgXcQ',
  });
});

test('treats an uppercase scheme as a link', async () => {
  const input = await classify('HTTPS://www.youtube.com/watch?v=dQw4w9WgXcQ', {});

  assert.equal(input.kind, 'link');
});

test('refuses a link to another site', async () => {
  await assertInvalidInput(async () => classify('https://vimeo.com/76979871', {}), UNSUPPORTED);
});

test('refuses a YouTube link that is not a single video', async () => {
  await assertInvalidInput(async () => classify('https://www.youtube.com/@RickAstleyYT', {}), UNSUPPORTED);
});

test('refuses a lookalike host', async () => {
  await assertInvalidInput(async () => classify('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', {}), UNSUPPORTED);
});

test('does not read a link as a path', async () => {
  await assertInvalidInput(async () => classify('http://example.com/talk.mp3', {}), UNSUPPORTED);
});
