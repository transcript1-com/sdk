import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import { Transcript1 } from '../../src/client.js';
import type { ClientOptions } from '../../src/config.js';
import type {
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
  extra: { client?: (fake: FakeApiType) => Transcript1; waitForServer?: boolean } = {},
): Promise<StartedType> => {
  const fake = await startApi(t, knobs);
  const t1 = extra.client?.(fake) ?? createClient(fake);
  const live = await t1.live.start(options);
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

export const payloadsOf = <K extends keyof LiveEvents>(started: StartedType, name: K): Array<LiveEvents[K]> => started.events
  .filter(event => event.name === name)
  .map(event => event.payload as LiveEvents[K]);

export const pcm = (...samples: number[]): Int16Array => Int16Array.from(samples);

export const concatFrames = (frames: Buffer[]): Buffer => Buffer.concat(frames);

export const frameOf = (value: number, bytes: number): Uint8Array => new Uint8Array(bytes).fill(value);

export const expectEnded = (result: LiveEndResult, reason: LiveEndResult['reason']): void => {
  assert.equal(result.reason, reason);
};
