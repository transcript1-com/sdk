import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const readme = await readFile(join(resolve(import.meta.dirname, '..'), 'README.md'), 'utf8');
const flat = readme.replaceAll(/\s+/g, ' ');

test('states the runtimes without promising more than the tests cover', () => {
  assert.ok(flat.includes('Node 20.19+. Bun and Deno should work through their `node:` compatibility; the automated tests run on Node only.'));
  assert.ok(!flat.includes('launch checklist'));
});

test('names the six platforms and the first-video limit', () => {
  assert.ok(flat.includes('Use public video links from YouTube, X, TikTok, Instagram, Facebook and Bluesky or upload audio and video files.'));
  assert.ok(flat.includes('For posts with several videos, only the first video is transcribed.'));
  assert.ok(flat.includes('SDK 1.0.1 and older accept only YouTube links. Update to 1.1.0 to use links from the other platforms.'));
  assert.ok(!flat.includes('Only YouTube links'));
});

test('links to the pricing page instead of listing prices', () => {
  assert.ok(flat.includes('https://transcript1.com/#pricing'));
  assert.ok(!flat.includes('$9'));
  assert.ok(!flat.includes('$90'));
});
