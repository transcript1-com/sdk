import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCreateBody, parseServerEvent } from '../../src/live/wire.js';
import {
  createClock, frameOf, startSession, until,
} from './helpers.js';

test('media identity reaches create and the group id reaches started', () => {
  const media = {
    url: 'https://example.com/video', key: 'one', title: 'One', duration: 120,
  };
  assert.deepEqual(buildCreateBody({ media }), { media });
  const event = parseServerEvent(JSON.stringify({ type: 'session.started', session_id: 'lv_1', group_id: 'tg_1' }));
  assert.equal(event?.type === 'started' && event.payload.groupId, 'tg_1');
});

test('positions are text commands, validated before sending', async t => {
  const { live, server } = await startSession(t);
  live.position(0, 10_000);
  live.position(100, 40_000);
  assert.throws(() => {
    live.position(99, 0);
  }, /position/i);
  assert.throws(() => {
    live.position(Number.NaN, 0);
  }, /position/i);
  await until(() => server.commands.length === 2);
  assert.deepEqual(server.commands.map((command): unknown => JSON.parse(command)), [
    { type: 'media.position', audio_ms: 0, media_ms: 10_000 },
    { type: 'media.position', audio_ms: 100, media_ms: 40_000 },
  ]);
  await live.end();
});

test('trimmed reconnect audio retains its media position on the resumed audio clock', async t => {
  const clock = createClock([500]);
  const { live, server } = await startSession(t, {}, { sampleRate: 8000 }, { clock });
  live.position(0, 20_000);
  server.drop(1006);
  await until(() => clock.isHeld(500));
  for (let index = 0; index < 15; index++) {
    live.send(frameOf(index + 1, 16_000));
  }

  clock.release(500);
  await until(() => server.frames.length === 10);
  const positions = server.commands.map((command): unknown => JSON.parse(command));
  assert.deepEqual(positions.at(-1), { type: 'media.position', audio_ms: 0, media_ms: 25_000 });
  await live.end();
});
