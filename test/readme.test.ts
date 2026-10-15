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

test('keeps YouTube-only support as a current limit', () => {
  assert.ok(flat.includes('Only YouTube links and files are supported for now.'));
});

test('links to the pricing page instead of listing prices', () => {
  assert.ok(flat.includes('https://transcript1.com/#pricing'));
  assert.ok(!flat.includes('$9'));
  assert.ok(!flat.includes('$90'));
});
