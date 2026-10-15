import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getMimeType } from '../../src/inputs/mime-type.js';

const expected: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
};

for (const [extension, type] of Object.entries(expected)) {
  test(`maps .${extension} to ${type}`, () => {
    assert.equal(getMimeType(`talk.${extension}`), type);
  });
}

test('compares the extension without case', () => {
  assert.equal(getMimeType('TALK.MP3'), 'audio/mpeg');
  assert.equal(getMimeType('Interview.M4a'), 'audio/mp4');
});

test('returns nothing for an unknown or missing extension', () => {
  assert.equal(getMimeType('notes.txt'), undefined);
  assert.equal(getMimeType('talk'), undefined);
  assert.equal(getMimeType('talk.'), undefined);
});

test('uses only the last extension', () => {
  assert.equal(getMimeType('talk.mp3.txt'), undefined);
  assert.equal(getMimeType('talk.txt.mp3'), 'audio/mpeg');
});
