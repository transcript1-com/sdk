import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { classify } from '../../src/inputs/classify.js';
import { classifyLink } from '../../src/inputs/classify-link.js';
import { assertInvalidInput } from './helpers.js';

const UNSUPPORTED = 'Use a supported public video link, or upload a file';

type FixtureType = {
  accept: Array<{ url: string; platform: string }>;
  reject: string[];
  foreign: string[];
};

const fixture = JSON.parse(readFileSync(new URL('../fixtures/social-urls.json', import.meta.url), 'utf8')) as FixtureType;

const readPlatform = (url: string): string => {
  const host = new URL(url).hostname.toLowerCase();
  if (host.endsWith('tiktok.com')) {
    return 'tiktok';
  }

  if (host.endsWith('instagram.com')) {
    return 'instagram';
  }

  if (host.endsWith('facebook.com')) {
    return 'facebook';
  }

  if (host === 'fb.watch') {
    return 'facebook';
  }

  if (host === 'bsky.app') {
    return 'bluesky';
  }

  return 'x';
};

test('turns a YouTube link into a link input with its canonical url', async () => {
  const input = await classify('https://youtu.be/dQw4w9WgXcQ?si=abc&t=10', {});

  assert.deepEqual(input, {
    kind: 'link',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    videoId: 'dQw4w9WgXcQ',
    platform: 'youtube',
  });
});

test('keeps accepting YouTube hosts with a www prefix like 1.0.1', async () => {
  const urls = [
    'https://www.youtu.be/dQw4w9WgXcQ',
    'https://www.m.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://www.music.youtube.com/watch?v=dQw4w9WgXcQ',
  ];
  for (const url of urls) {
    // eslint-disable-next-line no-await-in-loop
    const input = await classify(url, {});

    assert.deepEqual(input, {
      kind: 'link',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoId: 'dQw4w9WgXcQ',
      platform: 'youtube',
    }, url);
  }
});

test('treats an uppercase scheme as a link', async () => {
  const input = await classify('HTTPS://www.youtube.com/watch?v=dQw4w9WgXcQ', {});

  assert.equal(input.kind, 'link');
});

test('sends the trimmed raw url of an X link with no video id', async () => {
  const input = await classify('https://twitter.com/jack/status/20?s=20 ', {});

  assert.deepEqual(input, {
    kind: 'link',
    url: 'https://twitter.com/jack/status/20?s=20',
    videoId: null,
    platform: 'x',
  });
});

test('classifies every accepted fixture link with its platform and its raw url', async () => {
  for (const row of fixture.accept) {
    // eslint-disable-next-line no-await-in-loop
    const input = await classify(row.url, {});

    assert.deepEqual(input, {
      kind: 'link',
      url: row.url,
      videoId: null,
      platform: row.platform,
    }, row.url);
  }
});

test('leaves path checks for rejected fixture links to the api', async () => {
  for (const url of fixture.reject) {
    // eslint-disable-next-line no-await-in-loop
    const input = await classify(url, {});

    assert.deepEqual(input, {
      kind: 'link',
      url,
      videoId: null,
      platform: readPlatform(url),
    }, url);
  }
});

test('refuses every foreign fixture link', async () => {
  for (const url of fixture.foreign) {
    // eslint-disable-next-line no-await-in-loop
    await assertInvalidInput(async () => classifyLink(url), UNSUPPORTED);
  }
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
