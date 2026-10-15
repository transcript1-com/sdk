import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { afterEach, beforeEach, test } from 'node:test';
import { resolveConfig } from '../src/config.js';
import { Transcript1Error } from '../src/errors.js';
import { VERSION } from '../src/version.js';

const saved = {
  key: process.env.TRANSCRIPT1_API_KEY,
  url: process.env.TRANSCRIPT1_API_URL,
};

const restore = (name: string, value: string | undefined) => {
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name);
    return;
  }

  process.env[name] = value;
};

beforeEach(() => {
  delete process.env.TRANSCRIPT1_API_KEY;
  delete process.env.TRANSCRIPT1_API_URL;
});

afterEach(() => {
  restore('TRANSCRIPT1_API_KEY', saved.key);
  restore('TRANSCRIPT1_API_URL', saved.url);
});

test('rejects a missing api key with missing_api_key', () => {
  assert.throws(() => resolveConfig(), (error: unknown) => {
    assert.ok(error instanceof Transcript1Error);
    assert.equal(error.code, 'missing_api_key');
    return true;
  });
});

test('rejects an empty api key', () => {
  process.env.TRANSCRIPT1_API_KEY = '';

  assert.throws(() => resolveConfig({ apiKey: '' }), { code: 'missing_api_key' });
});

test('reads the key and url from the environment', () => {
  process.env.TRANSCRIPT1_API_KEY = 't1_env';
  process.env.TRANSCRIPT1_API_URL = 'http://127.0.0.1:3000/mock-api';

  const config = resolveConfig();

  assert.equal(config.apiKey, 't1_env');
  assert.equal(config.baseUrl, 'http://127.0.0.1:3000/mock-api');
});

test('prefers options over the environment', () => {
  process.env.TRANSCRIPT1_API_KEY = 't1_env';
  process.env.TRANSCRIPT1_API_URL = 'http://env.example';

  const config = resolveConfig({ apiKey: 't1_option', baseUrl: 'http://option.example' });

  assert.equal(config.apiKey, 't1_option');
  assert.equal(config.baseUrl, 'http://option.example');
});

test('uses the default url when reading the environment is denied', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'process');
  const denied = {
    get env(): never {
      throw new Error('NotCapable: Requires env access');
    },
  };
  Object.defineProperty(globalThis, 'process', { value: denied, configurable: true });

  try {
    assert.equal(resolveConfig({ apiKey: 't1_key' }).baseUrl, 'https://api.transcript1.com');
  } finally {
    Object.defineProperty(globalThis, 'process', saved!);
  }
});

test('falls back to the environment key when the apiKey option is empty', () => {
  process.env.TRANSCRIPT1_API_KEY = 't1_env';

  assert.equal(resolveConfig({ apiKey: '' }).apiKey, 't1_env');
  assert.equal(resolveConfig({ apiKey: '   ' }).apiKey, 't1_env');
});

test('uses the default url when the environment url is empty', () => {
  process.env.TRANSCRIPT1_API_URL = '';

  assert.equal(resolveConfig({ apiKey: 't1_key' }).baseUrl, 'https://api.transcript1.com');

  process.env.TRANSCRIPT1_API_URL = '  ';

  assert.equal(resolveConfig({ apiKey: 't1_key' }).baseUrl, 'https://api.transcript1.com');
});

test('uses the default url when the baseUrl option is empty', () => {
  assert.equal(resolveConfig({ apiKey: 't1_key', baseUrl: '' }).baseUrl, 'https://api.transcript1.com');
});

test('rejects a key that is empty in both the option and the environment', () => {
  process.env.TRANSCRIPT1_API_KEY = ' ';

  assert.throws(() => resolveConfig({ apiKey: '' }), { code: 'missing_api_key' });
});

test('accepts maxRetries from 0 to 10', () => {
  assert.equal(resolveConfig({ apiKey: 't1_key', maxRetries: 0 }).maxRetries, 0);
  assert.equal(resolveConfig({ apiKey: 't1_key', maxRetries: 10 }).maxRetries, 10);
});

for (const value of [-1, 1.5, Number.NaN, 11, Number.POSITIVE_INFINITY]) {
  test(`rejects maxRetries ${value} with invalid_input`, () => {
    assert.throws(() => resolveConfig({ apiKey: 't1_key', maxRetries: value }), (error: unknown) => {
      assert.ok(error instanceof Transcript1Error);
      assert.equal(error.code, 'invalid_input');
      assert.match(error.message, /maxRetries/);
      return true;
    });
  });
}

test('defaults the base url to the production api', () => {
  assert.equal(resolveConfig({ apiKey: 't1_key' }).baseUrl, 'https://api.transcript1.com');
});

test('trims trailing slashes from the base url', () => {
  const config = resolveConfig({ apiKey: 't1_key', baseUrl: 'http://127.0.0.1:3000/mock-api//' });

  assert.equal(config.baseUrl, 'http://127.0.0.1:3000/mock-api');
});

test('defaults maxRetries to 2 and accepts 0', () => {
  assert.equal(resolveConfig({ apiKey: 't1_key' }).maxRetries, 2);
  assert.equal(resolveConfig({ apiKey: 't1_key', maxRetries: 0 }).maxRetries, 0);
});

test('uses the global fetch unless one is given', () => {
  const custom = (async () => new Response()) as typeof fetch;

  assert.equal(resolveConfig({ apiKey: 't1_key', fetch: custom }).fetch, custom);
  assert.equal(typeof resolveConfig({ apiKey: 't1_key' }).fetch, 'function');
});

test('takes sleep and random from the internal overrides', () => {
  const sleep = async () => undefined;
  const random = () => 0.5;

  const config = resolveConfig({ apiKey: 't1_key' }, { sleep, random });

  assert.equal(config.sleep, sleep);
  assert.equal(config.random, random);
});

test('sleeps for the given time', async () => {
  const config = resolveConfig({ apiKey: 't1_key' });
  const started = Date.now();

  await config.sleep(30);

  assert.ok(Date.now() - started >= 25);
});

test('stops sleeping with aborted when the signal fires', async () => {
  const config = resolveConfig({ apiKey: 't1_key' });
  const controller = new AbortController();
  const pending = config.sleep(10_000, controller.signal);

  controller.abort();

  await assert.rejects(pending, { code: 'aborted' });
});

test('refuses to sleep with a signal that is already aborted', async () => {
  const config = resolveConfig({ apiKey: 't1_key' });

  await assert.rejects(config.sleep(10_000, AbortSignal.abort()), { code: 'aborted' });
});

test('exports a VERSION equal to package.json', async () => {
  const text = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const { version } = JSON.parse(text) as { version: string };

  assert.equal(VERSION, version);
});
