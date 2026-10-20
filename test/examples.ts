import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import {
  Transcript1,
  Transcript1Error,
  type Account,
  type ClientOptions,
  type CompletedTranscription,
  type DownloadOptions,
  type Format,
  type GetOptions,
  type ListParams,
  type ProgressEvent,
  type Transcription,
  type TranscriptionSummary,
  type TranscribeOptions,
} from '../src/index.js';

export const examples = async (buffer: Buffer, blob: Blob): Promise<void> => {
  const options: ClientOptions = {
    apiKey: 't1_key',
    baseUrl: 'https://api.transcript1.com',
    fetch,
    maxRetries: 3,
  };
  const t1 = new Transcript1(options);
  const fromEnv = new Transcript1();

  const onProgress = (event: ProgressEvent) => {
    switch (event.type) {
      case 'upload': {
        console.log(`${event.sent} of ${event.total} bytes`);
        break;
      }

      case 'status': {
        console.log(event.status);
        break;
      }

      case 'waiting_slot': {
        console.log(`waiting ${event.retryAfter} s for a job slot`);
        break;
      }

      case 'reconnecting': {
        console.log('reconnecting');
        break;
      }
    }
  };

  const transcribeOptions: TranscribeOptions = {
    speakers: true,
    language: 'auto',
    source: 'auto',
    fresh: false,
    idempotencyKey: 'call-1',
    onProgress,
    signal: AbortSignal.timeout(600_000),
  };

  const done: CompletedTranscription = await t1.transcribe('https://youtu.be/dQw4w9WgXcQ', transcribeOptions);
  const { text } = done.transcript;
  const asTranscription: Transcription = done;
  console.log(asTranscription.status);
  await t1.transcribe('./interview.m4a', { speakers: true });
  await t1.transcribe(buffer, { filename: 'call.mp3' });
  await t1.transcribe(new Uint8Array(10), { filename: 'call.wav' });
  await t1.transcribe(blob, { filename: 'call.ogg' });
  await t1.transcribe(Readable.toWeb(createReadStream('./big.mp4')) as ReadableStream<Uint8Array>, { filename: 'big.mp4', size: 1_000_000 });
  await t1.transcribe(createReadStream('./big.mov'), { filename: 'big.mov', size: 1_000_000 });
  await fromEnv.transcribe('https://youtu.be/dQw4w9WgXcQ');

  const format: Format = 'srt';
  const downloadOptions: DownloadOptions = { format, signal: AbortSignal.timeout(60_000) };
  const srt: string = await t1.download(done.id, downloadOptions);
  const plain: string = await t1.download(done.id, { timestamps: true });
  const json: string = await t1.download(done.id, { format: 'json' });
  await t1.download(done.id);

  const job: Transcription = await t1.transcriptions.create('https://youtu.be/dQw4w9WgXcQ', { fresh: true });
  const getOptions: GetOptions = {
    wait: true,
    includeWords: true,
    signal: AbortSignal.timeout(60_000),
    onProgress,
  };
  const finished = await t1.transcriptions.get(job.id, getOptions);
  await t1.transcriptions.get(job.id);
  if (finished.source.platform === 'upload') {
    const uploaded: string | null = finished.source.filename;
    console.log(uploaded);
  }

  for (const platform of ['twitch', 'dailymotion', 'pinterest', 'linkedin', 'snapchat'] as const) {
    const supported: ListParams = { platform };
    console.log(supported);
  }

  // @ts-expect-error Vimeo is not a supported platform
  const unknownPlatform: ListParams = { platform: 'vimeo' };
  console.log(unknownPlatform);

  const params: ListParams = { status: 'completed', platform: 'youtube', limit: 50 };
  for await (const item of t1.transcriptions.list(params)) {
    const summary: TranscriptionSummary = item;
    console.log(summary.id, summary.status);
  }

  for await (const item of t1.transcriptions.list()) {
    console.log(item.created_at);
  }

  await t1.transcriptions.delete(job.id);
  const account: Account = await t1.account();
  console.log(account.minutes.remaining, account.plan?.name, text, srt, plain, json, finished.status);

  try {
    await t1.transcribe('./missing.mp3', { signal: AbortSignal.timeout(1000) });
  } catch (error: unknown) {
    if (error instanceof Transcript1Error) {
      const { code } = error;
      const id: string | undefined = error.transcriptionId;
      const last: Transcription | undefined = error.transcription;
      console.log(code, id, last?.status, error.status, error.details, error.retryable);
    }
  }
};
