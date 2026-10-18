import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { detectLinkPlatform } from '../../src/inputs/detect-platform.js';

type FixtureType = {
  accept: Array<{ url: string; platform: string }>;
  reject: string[];
  foreign: string[];
};

const fixture = JSON.parse(readFileSync(new URL('../fixtures/social-urls.json', import.meta.url), 'utf8')) as FixtureType;

test('detects the platform of every accepted fixture link', () => {
  for (const row of fixture.accept) {
    assert.equal(detectLinkPlatform(row.url), row.platform, row.url);
  }
});

test('detects the host of links the api refuses by path', () => {
  assert.equal(detectLinkPlatform('https://x.com/jack'), 'x');
  assert.equal(detectLinkPlatform('https://www.tiktok.com/@scout2015'), 'tiktok');
  assert.equal(detectLinkPlatform('https://www.instagram.com/natgeo/'), 'instagram');
  assert.equal(detectLinkPlatform('https://www.facebook.com/NASA'), 'facebook');
  assert.equal(detectLinkPlatform('https://bsky.app/profile/bsky.app'), 'bluesky');
});

test('detects every YouTube host', () => {
  for (const host of ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']) {
    assert.equal(detectLinkPlatform(`https://${host}/watch?v=dQw4w9WgXcQ`), 'youtube', host);
  }
});

test('detects a YouTube host with a www prefix', () => {
  assert.equal(detectLinkPlatform('https://www.youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.equal(detectLinkPlatform('https://www.m.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(detectLinkPlatform('https://www.music.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
});

test('detects the short link hosts', () => {
  assert.equal(detectLinkPlatform('https://vm.tiktok.com/ZMabcdEF/'), 'tiktok');
  assert.equal(detectLinkPlatform('https://vt.tiktok.com/ZSabc123/'), 'tiktok');
  assert.equal(detectLinkPlatform('https://fb.watch/AbC_12-x/'), 'facebook');
});

test('reads the host in lowercase', () => {
  assert.equal(detectLinkPlatform('HTTPS://WWW.X.COM/jack/status/20'), 'x');
});

test('returns null for foreign links and non-http schemes', () => {
  for (const url of fixture.foreign) {
    assert.equal(detectLinkPlatform(url), null, url);
  }
});

test('returns null for a lookalike host', () => {
  assert.equal(detectLinkPlatform('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(detectLinkPlatform('https://api.bsky.app/profile/bsky.app'), null);
});
