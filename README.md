# @transcript1/sdk

TypeScript SDK for the [transcript1](https://transcript1.com) transcription API. Transcribe public videos from YouTube, X,
TikTok, Instagram, Facebook and Bluesky or upload audio and video files from server code.
Download transcripts as text, SRT, VTT or JSON.

Full documentation: https://transcript1.com/docs/sdk

## Install

```sh
npm i @transcript1/sdk
```

Node 20.19+. Bun and Deno should work through their `node:` compatibility; the automated tests run on Node only. Use
the SDK server-side only; never ship an API key to a browser.

The examples use ES modules. Save them as `.mjs` files, or set `"type": "module"` in `package.json` for `.js` files.
`require()` also works on Node 20.19+.

## API key

The client reads your API key from `TRANSCRIPT1_API_KEY`. You can also pass it to the constructor:

```ts
import { Transcript1 } from '@transcript1/sdk';

const t1 = new Transcript1(); // uses TRANSCRIPT1_API_KEY
const other = new Transcript1({ apiKey: 't1_...' });
```

Without a key the constructor throws a `Transcript1Error` with the code `missing_api_key`.

## Transcribe

`transcribe` creates a job and waits for its transcript. It returns a `completed` transcription with a `transcript`
field. Failed or canceled jobs reject.

```ts
const done = await t1.transcribe('https://youtu.be/dQw4w9WgXcQ'); // YouTube link
console.log(done.transcript.text);

await t1.transcribe('./interview.m4a', { speakers: true }); // file path
await t1.transcribe(buffer, { filename: 'call.mp3' }); // Buffer or Uint8Array
await t1.transcribe(blob, { filename: 'call.mp3' }); // Blob (a File brings its own name)
await t1.transcribe(stream, { filename: 'call.mp3', size: 4_200_000 }); // stream or async iterable
```

Strings starting with `http://` or `https://` are links; other strings are file paths. Use public video links from YouTube,
X, TikTok, Instagram, Facebook and Bluesky or upload audio and video files. For posts with several videos, only the first
video is transcribed. SDK 1.0.1 and older accept only YouTube links. Update to 1.1.0 to use links from the other platforms.
Files can be up to 2,000,000,000 bytes, with extensions mp3, wav, m4a, flac, ogg, opus, mp4, mov, webm or mkv.

## Download

`download` waits for the job if needed and returns a string.

```ts
const text = await t1.download(done.id); // plain text
const withTimes = await t1.download(done.id, { timestamps: true }); // text only
const srt = await t1.download(done.id, { format: 'srt' });
const vtt = await t1.download(done.id, { format: 'vtt' });
const json = await t1.download(done.id, { format: 'json' }); // the API's JSON text
```

`timestamps: true` with a format other than `text` rejects with `invalid_input`.

## Background jobs

```ts
const job = await t1.transcriptions.create('./long-interview.mp4'); // returns once the job is queued
const now = await t1.transcriptions.get(job.id); // current state, at once
const finished = await t1.transcriptions.get(job.id, { wait: true }); // until it ends
```

`get(id, { wait: true })` returns the finished object whether its status is `completed`, `failed` or `canceled`.
Check the status before reading its transcript. Pass `includeWords: true` to include word timings.

## List, delete, account

```ts
for await (const item of t1.transcriptions.list({ status: 'completed', limit: 50 })) {
  console.log(item.id, item.created_at);
}

await t1.transcriptions.delete(job.id); // cancels a running job, deletes a finished one
const account = await t1.account();
```

`list` fetches pages as you iterate. Params: `status`, `platform`, `limit` (page size, 1 to 100, API default 20) and `signal`.
Filter by `platform` with `youtube`, `x`, `tiktok`, `instagram`, `facebook`, `bluesky` or `upload`.

## Options

The constructor accepts `apiKey`, `baseUrl`, `fetch` and `maxRetries` (default 2). `baseUrl` defaults to
`TRANSCRIPT1_API_URL` when set, otherwise `https://api.transcript1.com`.

`transcribe` and `transcriptions.create`:

| Option | Meaning |
| --- | --- |
| `speakers` | label speakers |
| `language` | `auto` (default) or an ISO 639-1 code |
| `source` | `auto`, `captions` or `stt`; links only |
| `fresh` | links: skip reusing a result from the last 24 hours |
| `filename` | required for Buffers, Blobs without a name and streams |
| `size` | required for streams, in bytes |
| `idempotencyKey` | defaults to a new UUID per call |
| `onProgress` | progress callback |
| `signal` | an `AbortSignal` |

`download`: `format` (`text`, `srt`, `vtt`, `json`), `timestamps`, `signal`.

`transcriptions.get`: `wait`, `includeWords`, `onProgress`, `signal`. Progress events are reported while waiting.

Returned objects keep the API's field names (`snake_case`).

## Progress

```ts
await t1.transcribe('./interview.m4a', {
  onProgress(event) {
    if (event.type === 'upload') {
      console.log(`${event.sent} of ${event.total} bytes`);
    } else if (event.type === 'status') {
      console.log(event.status);
    } else if (event.type === 'waiting_slot') {
      console.log(`all job slots are busy, retrying in ${event.retryAfter} s`);
    } else {
      console.log('reconnecting');
    }
  },
});
```

## Abort

Pass an `AbortSignal` to set a time limit or cancel a call:

```ts
await t1.transcribe(url, { signal: AbortSignal.timeout(10 * 60_000) });
```

Aborting before any request rejects with `aborted` and no id. During an upload, the SDK tries to delete the job if it is
still `awaiting_upload`, then rejects with `aborted` and the id. Aborting while waiting leaves the job running; the error
carries `transcriptionId`, so you can resume with `get(id, { wait: true })`.

## Errors

Catch `Transcript1Error` to read API, job and SDK error codes:

```ts
import { Transcript1Error } from '@transcript1/sdk';

try {
  await t1.transcribe('./call.mp3');
} catch (error) {
  if (error instanceof Transcript1Error) {
    console.error(error.code, error.message, error.transcriptionId);
  }
}
```

| Field | Meaning |
| --- | --- |
| `code` | API code (`insufficient_minutes`, `not_found`, ...), a job failure code (`no_captions`, `no_speech`, ...), `canceled`, or a local code |
| `status` | HTTP status; absent for job and local errors |
| `details` | extra fields of the API's error, e.g. `minutes_needed`, `action_url` |
| `retryable` | whether trying again can help |
| `transcriptionId` | the job, whenever one exists |
| `transcription` | the last object seen, when there is one |

Local codes: `missing_api_key`, `invalid_input`, `aborted`, `network_error`, `upload_token_refused`. A non-JSON error
body gives `http_<status>`.

A job that failed without an error object rejects with `transcription_failed`. If the API ever returns a completed job
without its transcript, `transcribe` rejects with `internal_error`.

`transcribe` resolves with a `CompletedTranscription`: a `Transcription` whose `status` is `completed` and whose
`transcript` is always present, so `done.transcript.text` type-checks.

## Waiting and retries

While waiting for a job, the SDK retries dropped connections and HTTP 429, 500, 502, 503 and 504 responses without a
retry limit. Reconnection waits increase from 2 to 4, 8, 16 and then 30 seconds; use `signal` to bound the total time.
Other requests retry up to `maxRetries` times. When
your plan's active-job limit is reached, `transcribe` and `transcriptions.create` wait for a slot and retry.

## Plans

See plans and prices at https://transcript1.com/#pricing.

## Support

support@transcript1.com
