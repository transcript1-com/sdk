import type { LinkPlatformType } from '../../src/inputs/types.js';
import type { Chunk, Status } from '../../src/types.js';
import type { FakeLiveSessionType } from './live-session.js';

export type KnobsType = {
  key: string;
  prefix: string;
  chunkSize: number;
  polls: number;
  activeLimit: number;
  openUploadLimit: number;
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
  liveError: LiveErrorKnobType | undefined;
  liveTokenError: LiveErrorKnobType | undefined;
  liveGetError: LiveErrorKnobType | undefined;
  altKeys: string[];
  // reject this many upcoming sockets with 4001, even with a valid token
  liveRejectConnects: number;
  liveManualStart: boolean;
  liveAutoEnd: boolean;
};

export type LiveErrorKnobType = {
  status: number;
  code: string;
  message?: string;
  retryAfter?: number;
  retryable?: boolean;
  extra?: Record<string, unknown>;
};

export type JobType = {
  id: string;
  seq: number;
  status: Status;
  platform: LinkPlatformType | 'upload';
  url: string;
  videoId: string;
  title: string;
  filename: string;
  size: number;
  source: 'auto' | 'captions' | 'stt';
  language: string;
  diarize: boolean;
  translateTo?: string;
  translated?: string[];
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
  liveSessions: Map<string, FakeLiveSessionType>;
  closing: Promise<void>;
  release: () => void;
};

export const buildDefaultKnobs = (): KnobsType => ({
  key: 't1_test',
  prefix: '',
  chunkSize: 8,
  polls: 1,
  activeLimit: 0,
  openUploadLimit: 0,
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
  liveError: undefined,
  liveTokenError: undefined,
  liveGetError: undefined,
  altKeys: [],
  liveRejectConnects: 0,
  liveManualStart: false,
  liveAutoEnd: true,
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
    liveSessions: new Map(),
    closing,
    release,
  };
};
