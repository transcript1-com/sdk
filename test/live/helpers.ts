import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { Transcript1 } from '../../src/client.js';
import { resolveConfig, type ClientOptions } from '../../src/config.js';
import { buildAbortedError } from '../../src/errors.js';
import { createLive } from '../../src/live/client.js';
import { END_TIMEOUT_MS } from '../../src/live/session.js';
import type {
  Live,
  LiveEndResult,
  LiveEvents,
  LiveSession,
  LiveStartOptions,
} from '../../src/live/types.js';
import type { FakeApiType, KnobsType } from '../fake-api/server.js';
import type { FakeLiveSessionType } from '../fake-api/live-session.js';
import { startApi } from '../uploads/helpers.js';

export { startApi } from '../uploads/helpers.js';

export const createClient = (fake: FakeApiType, options: ClientOptions = {}): Transcript1 => new Transcript1({
  apiKey: 't1_test',
  baseUrl: fake.url,
  ...options,
});

export const until = async (check: () => boolean, message = 'condition was not met in time'): Promise<void> => {
  for (let attempt = 0; attempt < 400; attempt++) {
    if (check()) {
      return;
    }

    // eslint-disable-next-line no-await-in-loop
    await delay(5);
  }

  assert.fail(message);
};

type HeldType = {
  ms: number;
  release: () => void;
};

export type ClockType = {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  // every duration the sdk slept, in order
  delays: number[];
  // sleeps of these durations wait until released; all others finish at once
  hold: Set<number>;
  isHeld: (ms: number) => boolean;
  release: (ms: number) => void;
};

// a fake clock: sleeping moves time forward without waiting
export const createClock = (hold: number[] = [END_TIMEOUT_MS]): ClockType => {
  let time = 0;
  const delays: number[] = [];
  const held: HeldType[] = [];
  const holdSet = new Set(hold);

  return {
    now: () => time,
    delays,
    hold: holdSet,
    async sleep(ms, signal) {
      delays.push(ms);

      return new Promise<void>((resolve, reject) => {
        const finish = () => {
          time += ms;
          resolve();
        };

        if (!holdSet.has(ms)) {
          setImmediate(finish);
          return;
        }

        const entry: HeldType = { ms, release: finish };
        held.push(entry);
        signal?.addEventListener('abort', () => {
          held.splice(held.indexOf(entry), 1);
          reject(buildAbortedError());
        }, { once: true });
      });
    },
    isHeld: ms => held.some(entry => entry.ms === ms),
    release(ms) {
      const index = held.findIndex(entry => entry.ms === ms);
      assert.notEqual(index, -1, `no sleep of ${String(ms)} ms is held`);
      const [entry] = held.splice(index, 1);
      entry?.release();
    },
  };
};

export const createClockedLive = (fake: FakeApiType, clock: ClockType, options: ClientOptions = {}): Live => createLive(resolveConfig({
  apiKey: 't1_test',
  baseUrl: fake.url,
  ...options,
}, { sleep: clock.sleep, now: clock.now }));

export type StartedType = {
  fake: FakeApiType;
  live: LiveSession;
  server: FakeLiveSessionType;
  events: Array<{ name: keyof LiveEvents; payload: unknown }>;
};

const EVENT_NAMES: Array<keyof LiveEvents> = ['started', 'line', 'usage', 'warning', 'reconnecting', 'reconnected', 'ended', 'error'];

export const startSession = async (
  t: TestContext,
  knobs: Partial<KnobsType> = {},
  options: LiveStartOptions = {},
  extra: { client?: (fake: FakeApiType) => Transcript1; clock?: ClockType; waitForServer?: boolean } = {},
): Promise<StartedType> => {
  const fake = await startApi(t, knobs);
  const api = extra.clock ? createClockedLive(fake, extra.clock) : (extra.client?.(fake) ?? createClient(fake)).live;
  const live = await api.start(options);
  const events: StartedType['events'] = [];
  for (const name of EVENT_NAMES) {
    live.on(name, payload => {
      events.push({ name, payload });
    });
  }

  const server = fake.liveSessions.get(live.id);
  assert.ok(server, 'the fake api knows the session');
  // the socket is open when start resolves, but the server side attaches a tick later
  if (extra.waitForServer !== false) {
    await until(() => server.socket !== undefined);
  }

  return {
    fake, live, server, events,
  };
};

export type ManualType = {
  fake: FakeApiType;
  server: FakeLiveSessionType;
  pending: Promise<LiveSession>;
};

// start() waits for session.started, so the test sends it by hand
export const startManual = async (t: TestContext, options: LiveStartOptions = {}): Promise<ManualType> => {
  const fake = await startApi(t, { liveManualStart: true });
  const pending = createClient(fake).live.start(options);
  pending.catch(() => undefined);
  await until(() => fake.liveSessions.get('lv_1')?.socket !== undefined);
  const server = fake.liveSessions.get('lv_1');
  assert.ok(server);

  return { fake, server, pending };
};

export const payloadsOf = <K extends keyof LiveEvents>(started: StartedType, name: K): Array<LiveEvents[K]> => started.events
  .filter(event => event.name === name)
  .map(event => event.payload as LiveEvents[K]);

export const pcm = (...samples: number[]): Int16Array => Int16Array.from(samples);

export const concatFrames = (frames: Buffer[]): Buffer => Buffer.concat(frames);

export const frameOf = (value: number, bytes: number): Uint8Array => new Uint8Array(bytes).fill(value);

export const expectEnded = (result: LiveEndResult, reason: LiveEndResult['reason']): void => {
  assert.equal(result.reason, reason);
};
