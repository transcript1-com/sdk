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

test('names qualified platforms and links to their individual-media limits', () => {
  assert.ok(flat.includes('Use public video links from YouTube, X, TikTok, Instagram, Facebook, Bluesky, Twitch, Dailymotion, Pinterest, LinkedIn and Snapchat or upload audio and video files.'));
  assert.ok(flat.includes('Pinterest video pins, LinkedIn public video posts and Snapchat Spotlight.'));
  assert.ok(flat.includes('SDK 1.1.0 and older reject Twitch, Dailymotion, Pinterest, LinkedIn and Snapchat links locally; use 1.2.0 or newer.'));
  assert.ok(!flat.includes('use a release that includes the required platform.'));
  assert.ok(!flat.includes('Only YouTube links'));
});

test('links to the pricing page instead of listing prices', () => {
  assert.ok(flat.includes('https://transcript1.com/#pricing'));
  assert.ok(!flat.includes('$9'));
  assert.ok(!flat.includes('$90'));
});

test('explains X captions and their segment-only timing', () => {
  for (const fact of ['YouTube and X', 'x_captions', 'youtube_captions', 'speech_to_text', 'words: null', 'same per-minute price']) {
    assert.ok(flat.includes(fact), fact);
  }
});
