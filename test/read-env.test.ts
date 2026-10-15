import assert from 'node:assert/strict';
import process from 'node:process';
import { afterEach, test } from 'node:test';
import { readEnv } from '../src/read-env.js';

type GlobalWithDenoType = { Deno?: unknown };

const holder = globalThis as GlobalWithDenoType;

const getDenoEnv = (name: string) => {
  if (name === 'T1_READ_ENV_TEST') {
    return 'from-deno';
  }

  return undefined;
};

afterEach(() => {
  Reflect.deleteProperty(holder, 'Deno');
  Reflect.deleteProperty(process.env, 'T1_READ_ENV_TEST');
});

test('reads a variable from the process environment', () => {
  process.env.T1_READ_ENV_TEST = 'from-process';

  assert.equal(readEnv('T1_READ_ENV_TEST'), 'from-process');
});

test('returns undefined for an unset variable', () => {
  assert.equal(readEnv('T1_READ_ENV_TEST'), undefined);
});

test('falls back to Deno.env when there is no process', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'process');
  holder.Deno = { env: { get: getDenoEnv } };
  Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true });

  try {
    assert.equal(readEnv('T1_READ_ENV_TEST'), 'from-deno');
  } finally {
    Object.defineProperty(globalThis, 'process', saved!);
  }
});

test('treats a refused Deno permission as unset', () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'process');
  holder.Deno = {
    env: {
      get() {
        throw new Error('NotCapable: Requires env access');
      },
    },
  };
  Object.defineProperty(globalThis, 'process', { value: undefined, configurable: true });

  try {
    assert.equal(readEnv('T1_READ_ENV_TEST'), undefined);
  } finally {
    Object.defineProperty(globalThis, 'process', saved!);
  }
});
