import type { Chunk, Status } from '../../src/types.js';

export type KnobsType = {
  key: string;
  prefix: string;
  chunkSize: number;
  polls: number;
  activeLimit: number;
  minutesLeft: number;
  minutesPerJob: number;
  chunkStatus: Record<number, number[]>;
  completeMissing: number[];
  failCode: string;
  titles: Record<string, string>;
  blockChunks: Promise<unknown> | undefined;
  pollErrors: number[];
  dropPolls: number;
  pageSize: number;
};

export type JobType = {
  id: string;
  seq: number;
  status: Status;
  platform: 'youtube' | 'upload';
  url: string;
  videoId: string;
  title: string;
  filename: string;
  size: number;
  source: 'auto' | 'captions' | 'stt';
  language: string;
  diarize: boolean;
  idempotencyKey: string | undefined;
  params: string;
  token: string;
  chunks: Chunk[];
  received: Set<number>;
  data: Uint8Array | undefined;
  polls: number;
  charged: number;
  errorCode: string | undefined;
  createdAt: Date;
  completedAt: Date | undefined;
};

export type RecordedRequestType = {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | undefined;
  chunk: number | undefined;
};

export type StateType = {
  knobs: KnobsType;
  jobs: Map<string, JobType>;
  order: JobType[];
  log: string[];
  requests: RecordedRequestType[];
  chunkCalls: Map<number, number>;
  nextId: number;
  nextToken: number;
  completes: number;
  inFlight: number;
  peakChunks: number;
  peakActive: number;
  closing: Promise<void>;
  release: () => void;
};

export const buildDefaultKnobs = (): KnobsType => ({
  key: 't1_test',
  prefix: '',
  chunkSize: 8,
  polls: 1,
  activeLimit: 0,
  minutesLeft: -1,
  minutesPerJob: 1,
  chunkStatus: {},
  completeMissing: [],
  failCode: '',
  titles: {},
  blockChunks: undefined,
  pollErrors: [],
  dropPolls: 0,
  pageSize: 20,
});

export const createState = (options: Partial<KnobsType> = {}): StateType => {
  const defaults = buildDefaultKnobs();
  let release: () => void = () => undefined;
  const closing = new Promise<void>(resolve => {
    release = resolve;
  });

  return {
    knobs: {
      ...defaults,
      ...options,
      pollErrors: [...(options.pollErrors ?? defaults.pollErrors)],
    },
    jobs: new Map(),
    order: [],
    log: [],
    requests: [],
    chunkCalls: new Map(),
    nextId: 0,
    nextToken: 0,
    completes: 0,
    inFlight: 0,
    peakChunks: 0,
    peakActive: 0,
    closing,
    release,
  };
};
