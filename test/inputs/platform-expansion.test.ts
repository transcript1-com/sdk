import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectLinkPlatform } from '../../src/inputs/detect-platform.js';
import { classifyLink } from '../../src/inputs/classify-link.js';

const cases = [
  ['twitch', ['twitch.tv', 'www.twitch.tv', 'm.twitch.tv', 'go.twitch.tv', 'clips.twitch.tv'], '/videos/123'],
  ['dailymotion', ['dailymotion.com', 'www.dailymotion.com', 'touch.dailymotion.com', 'dai.ly'], '/video/x123'],
  ['pinterest', ['pinterest.com', 'www.pinterest.com'], '/pin/123/'],
  ['linkedin', ['linkedin.com', 'www.linkedin.com'], '/feed/update/urn:li:activity:123/'],
  ['snapchat', ['snapchat.com', 'www.snapchat.com'], '/spotlight/Ab_C'],
] as const;

for (const [platform, hosts, path] of cases) {
  test(`detects ${platform} exact hosts and passes the whole URL to the API`, () => {
    for (const host of hosts) {
      const url = `https://${host}${path}?t=30`;
      assert.equal(detectLinkPlatform(url), platform, url);
      assert.deepEqual(classifyLink(url), {
        kind: 'link', platform, url, videoId: null,
      });
    }
  });

  test(`rejects unsafe ${platform} authorities`, () => {
    for (const host of hosts) {
      for (const url of [
        `http://${host}${path}`,
        `https://user@${host}${path}`,
        `https://@${host}${path}`,
        `https://${host}:8443${path}`,
        `https://${host}.evil.example${path}`,
      ]) {
        assert.equal(detectLinkPlatform(url), null, url);
      }
    }
  });
}

test('does not promote unqualified platforms or deferred aliases', () => {
  for (const host of ['reddit.com', 'vimeo.com', 'threads.com', 'pin.it', 'lnkd.in', 'pinterest.co.uk']) {
    assert.equal(detectLinkPlatform(`https://${host}/123`), null, host);
  }
});
