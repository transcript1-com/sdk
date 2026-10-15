import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseYoutube } from '../../src/inputs/parse-youtube.js';

type VectorsType = { accept: string[]; reject: string[] };

const vectors = JSON.parse(readFileSync(new URL('../fixtures/youtube-urls.json', import.meta.url), 'utf8')) as VectorsType;

test('has the shared set of 9 accepted and 9 rejected links', () => {
  assert.equal(vectors.accept.length, 9);
  assert.equal(vectors.reject.length, 9);
});

for (const link of vectors.accept) {
  test(`accepts ${link}`, () => {
    assert.deepEqual(parseYoutube(link), {
      videoId: 'dQw4w9WgXcQ',
      canonicalUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
  });
}

for (const link of vectors.reject) {
  test(`rejects ${link}`, () => {
    assert.equal(parseYoutube(link), undefined);
  });
}

test('ignores the case of the host', () => {
  assert.equal(parseYoutube('https://WWW.YouTube.com/watch?v=dQw4w9WgXcQ')?.videoId, 'dQw4w9WgXcQ');
});
