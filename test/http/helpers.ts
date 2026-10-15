import assert from 'node:assert/strict';
import { resolveConfig, type ConfigType } from '../../src/config.js';
import { Transcript1Error } from '../../src/errors.js';

export const expectRejection = async (promise: Promise<unknown>): Promise<Transcript1Error> => {
  try {
    await promise;
  } catch (error: unknown) {
    assert.ok(error instanceof Transcript1Error, `expected a Transcript1Error, got ${String(error)}`);
    return error;
  }

  throw new assert.AssertionError({ message: 'expected the request to fail' });
};

export type CallType = {
  url: string;
  init: RequestInit;
};

type StepType = Error | (() => Response | Promise<Response>);

export const buildReply = (status: number, body = '', headers: Record<string, string> = {}): StepType => () => new Response(body || null, { status, headers });

export const buildJsonReply = (status: number, body: unknown, headers: Record<string, string> = {}): StepType => buildReply(status, JSON.stringify(body), {
  'Content-Type': 'application/json',
  ...headers,
});

export const createScriptedFetch = (steps: StepType[]) => {
  const calls: CallType[] = [];
  const stub = (async (input: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(input), init });
    const step = steps[Math.min(calls.length, steps.length) - 1];
    if (step instanceof Error) {
      throw step;
    }

    return step?.();
  }) as typeof fetch;

  return { calls, fetch: stub };
};

type TestConfigType = {
  config: ConfigType;
  sleeps: number[];
};

type ConfigOptionsType = {
  fetch?: typeof fetch;
  baseUrl?: string;
  apiKey?: string;
  maxRetries?: number;
  random?: () => number;
  sleep?: ConfigType['sleep'];
};

export const createTestConfig = (options: ConfigOptionsType = {}): TestConfigType => {
  const sleeps: number[] = [];
  const config = resolveConfig(
    {
      apiKey: options.apiKey ?? 't1_test',
      baseUrl: options.baseUrl ?? 'http://api.test',
      fetch: options.fetch,
      maxRetries: options.maxRetries,
    },
    {
      sleep: options.sleep ?? (async ms => {
        sleeps.push(ms);
      }),
      random: options.random ?? (() => 0),
    },
  );

  return { config, sleeps };
};

export const getHeader = (call: CallType | undefined, name: string): string | null => new Headers(call?.init.headers).get(name);
