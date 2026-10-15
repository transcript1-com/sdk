# @transcript1/sdk

TypeScript SDK for the [transcript1](https://transcript1.com) transcription API. Transcribe YouTube links and audio or
video files from server code, then download the transcript as text, SRT, VTT or JSON.

Full documentation: https://transcript1.com/docs/sdk

## Install

```sh
npm i @transcript1/sdk
```

Runs on Node 20.19+, Bun and Deno. It is for server code only: never ship an API key to a browser.

## API key

Use your transcript1 API key. The client reads `TRANSCRIPT1_API_KEY` from the environment, or you pass it:

```ts
import { Transcript1 } from '@transcript1/sdk';

const t1 = new Transcript1(); // uses TRANSCRIPT1_API_KEY
const other = new Transcript1({ apiKey: 't1_...' });
```

Without a key the constructor throws a `Transcript1Error` with the code `missing_api_key`.

## Transcribe

`transcribe` creates the job and waits until it is done. It resolves with a `completed` transcription that includes
`transcript`, and rejects if the job failed or was canceled.

```ts
const done = await t1.transcribe('https://youtu.be/dQw4w9WgXcQ'); // YouTube link
console.log(done.transcript.text);

await t1.transcribe('./interview.m4a', { speakers: true }); // file path
await t1.transcribe(buffer, { filename: 'call.mp3' }); // Buffer or Uint8Array
await t1.transcribe(blob, { filename: 'call.mp3' }); // Blob (a File brings its own name)
await t1.transcribe(stream, { filename: 'call.mp3', size: 4_200_000 }); // stream or async iterable
```

A string that starts with `http://` or `https://` is a link, any other string is a file path. Only YouTube links and
files are supported for now. Files: mp3, wav, m4a, flac, ogg, opus, mp4, mov, webm, mkv, up to 2,000,000,000 bytes.

## Download

`download` waits for the job if needed and returns a string.

```ts
const text = await t1.download(done.id); // plain text
const withTimes = await t1.download(done.id, { timestamps: true }); // text only
const srt = await t1.download(done.id, { format: 'srt' });
const vtt = await t1.download(done.id, { format: 'vtt' });
const json = await t1.download(done.id, { format: 'json' }); // the API's JSON text
```

`timestamps` with a format other than `text` throws `invalid_input`.

## Background jobs

```ts
const job = await t1.transcriptions.create('./long-interview.mp4'); // returns once the job is queued
const now = await t1.transcriptions.get(job.id); // current state, at once
const finished = await t1.transcriptions.get(job.id, { wait: true }); // until it ends
```

`get(id, { wait: true })` is a read: it resolves with the finished object whatever its status (`completed`, `failed` or
`canceled`). Pass `includeWords: true` to include word timings.

## List, delete, account

```ts
for await (const item of t1.transcriptions.list({ status: 'completed', limit: 50 })) {
  console.log(item.id, item.created_at);
}

await t1.transcriptions.delete(job.id); // cancels a running job, deletes a finished one
const account = await t1.account();
```

`list` pages automatically. Params: `status`, `platform` (`youtube` or `upload`), `limit` (page size, 1 to 100, default 20).

## Options

Client: `apiKey`, `baseUrl` (default `https://api.transcript1.com`, or `TRANSCRIPT1_API_URL`), `fetch`, `maxRetries`
(default 2).

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

Pass an `AbortSignal` to bound or cancel a call:

```ts
await t1.transcribe(url, { signal: AbortSignal.timeout(10 * 60_000) });
```

Aborting before any request rejects with `aborted` and no id. Aborting an upload deletes the job if it is still
awaiting its upload, then rejects with `aborted` and the id. Aborting while waiting leaves the job running; the error
carries `transcriptionId`, so you can resume with `get(id, { wait: true })`.

## Errors

Every failure is a `Transcript1Error`:

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

## Waiting and retries

While a job exists, dropped connections and 429, 500, 502, 503 and 504 answers are retried without limit, backing off
2, 4, 8, 16 and then 30 seconds; bound the total time with `signal`. Other requests retry up to `maxRetries` times. When
your plan's active-job limit is reached, `transcribe` and `transcriptions.create` wait for a slot and retry.

## Plans

Free: 60 minutes once. Paid: $9/month or $90/year. See https://transcript1.com.

## Support

support@transcript1.com
