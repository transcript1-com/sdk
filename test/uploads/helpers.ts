import type { TestContext } from 'node:test';
import type { ConfigType } from '../../src/config.js';
import { classifyData } from '../../src/inputs/classify-data.js';
import type { FileInputType } from '../../src/inputs/types.js';
import type { ProgressEvent } from '../../src/types.js';
import type { CreateBodyType, UploadOptionsType } from '../../src/uploads/types.js';
import {
  startFakeApi,
  type FakeApiType,
  type KnobsType,
  type RecordedRequestType,
} from '../fake-api/server.js';
import { createTestConfig } from '../http/helpers.js';
import { buildSequence } from '../inputs/helpers.js';

export { buildSequence } from '../inputs/helpers.js';

export const startApi = async (t: TestContext, knobs: Partial<KnobsType> = {}): Promise<FakeApiType> => {
  const fake = await startFakeApi(knobs);
  t.after(async () => fake.close());

  return fake;
};

export type ChunkReplyType = {
  index: number;
  status: number;
};

const findChunkIndex = (input: string | URL | Request, init?: RequestInit): number | undefined => {
  if (init?.method !== 'PUT') {
    return undefined;
  }

  const match = /\/upload\/chunks\/(\d+)$/.exec(String(input));
  if (!match) {
    return undefined;
  }

  return Number(match[1]);
};

export const createUploadConfig = (fake: FakeApiType): { config: ConfigType; replies: ChunkReplyType[] } => {
  const replies: ChunkReplyType[] = [];
  const recording = (async (input: string | URL | Request, init?: RequestInit) => {
    const response = await fetch(input, init);
    const index = findChunkIndex(input, init);
    if (index !== undefined) {
      replies.push({ index, status: response.status });
    }

    return response;
  }) as typeof fetch;
  const { config } = createTestConfig({ fetch: recording, baseUrl: fake.url });

  return { config, replies };
};

type KindType = 'bytes' | 'blob' | 'stream';

const createPieces = (bytes: Uint8Array, pieceSize: number): ReadableStream<Uint8Array> => {
  let offset = 0;

  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }

      controller.enqueue(bytes.slice(offset, offset + pieceSize));
      offset += pieceSize;
    },
  });
};

export const buildFile = (bytes: Uint8Array, kind: KindType = 'bytes', size = bytes.byteLength): FileInputType => {
  const filename = 'talk.mp3';
  if (kind === 'blob') {
    return classifyData(new Blob([bytes as Uint8Array<ArrayBuffer>]), { filename });
  }

  if (kind === 'stream') {
    return classifyData(createPieces(bytes, 5), { filename, size });
  }

  return classifyData(bytes, { filename });
};

export const buildBody = (file: FileInputType): CreateBodyType => ({
  upload: { filename: file.filename, size: file.size, mime_type: file.mimeType },
  language: 'auto',
  diarize: false,
});

export const buildOptions = (file: FileInputType, extra: Partial<UploadOptionsType> = {}): UploadOptionsType & { events: ProgressEvent[] } => {
  const events: ProgressEvent[] = [];

  return {
    idempotencyKey: 'key-1',
    body: buildBody(file),
    onProgress(event) {
      events.push(event);
    },
    async waitSlot() {
      throw new Error('waitSlot was not expected');
    },
    ...extra,
    events,
  };
};

export const buildBytes = (length: number): Uint8Array => buildSequence(length);

export const getPuts = (fake: FakeApiType): number[] => {
  const puts: number[] = [];
  for (const request of fake.requests) {
    if (request.chunk !== undefined) {
      puts.push(request.chunk);
    }
  }

  return puts;
};

const matchesRequest = (request: RecordedRequestType, method: string, path: RegExp): boolean => {
  if (request.method !== method) {
    return false;
  }

  return path.test(request.path);
};

export const findRequests = (fake: FakeApiType, method: string, path: RegExp): RecordedRequestType[] => fake.requests.filter(request => matchesRequest(request, method, path));

export const countRequests = (fake: FakeApiType, method: string, path: RegExp): number => findRequests(fake, method, path).length;

export const getUploadEvents = (events: ProgressEvent[]): Array<[number, number]> => {
  const uploads: Array<[number, number]> = [];
  for (const event of events) {
    if (event.type === 'upload') {
      uploads.push([event.sent, event.total]);
    }
  }

  return uploads;
};

export const tick = async (ms = 5): Promise<void> => new Promise(resolve => {
  setTimeout(resolve, ms);
});

export const createGate = (): { promise: Promise<void>; open: () => void } => {
  let open: () => void = () => undefined;
  const promise = new Promise<void>(resolve => {
    open = resolve;
  });

  return { promise, open };
};
