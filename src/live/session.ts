import { ERROR_CODES } from '../codes.js';
import { buildAbortedError, Transcript1Error } from '../errors.js';
import { createEmitter } from './emitter.js';
import { upsertLine } from './lines.js';
import type {
  LiveEndResult,
  LiveEvents,
  LiveLine,
  LiveSession,
} from './types.js';
import {
  END_COMMAND,
  FINALIZE_COMMAND,
  LIVE_PROTOCOL,
  MAX_FRAME_BYTES,
  parseServerEvent,
  type LiveCreated,
  type ServerEvent,
} from './wire.js';

const SOCKET_OPEN = 1;
const HELD_AUDIO_SECONDS = 10;
const END_TIMEOUT_MS = 30_000;
const CLOSE_NORMAL = 1000;

type QueuedType =
  | { kind: 'audio'; data: Uint8Array }
  | { kind: 'finalize' }
  | { kind: 'end' };

type DeferredType<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

const createDeferred = <T>(): DeferredType<T> => {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
};

type UsageType = Pick<LiveEvents['usage'], 'audioMs' | 'connectedMs' | 'minutesCharged'>;

const toBytes = (audio: Int16Array | Uint8Array | ArrayBuffer): Uint8Array => {
  // copy: callers reuse their buffers, and a socket may queue ours
  if (ArrayBuffer.isView(audio)) {
    return new Uint8Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
  }

  if (typeof (audio as ArrayBuffer | undefined)?.byteLength === 'number') {
    return new Uint8Array(audio);
  }

  throw new Transcript1Error(ERROR_CODES.invalid_input, 'Audio must be an Int16Array, a Uint8Array or an ArrayBuffer');
};

export class Session implements LiveSession {
  readonly id: string;
  readonly lines: LiveLine[] = [];
  #transcriptionId: string | null;
  readonly #socket: WebSocket;
  readonly #emitter = createEmitter<LiveEvents>();
  readonly #maxHeldBytes: number;
  readonly #done = createDeferred<LiveEndResult>();
  readonly #opened = createDeferred<void>();
  #queue: QueuedType[] = [];
  #queuedBytes = 0;
  #started = false;
  #finished = false;
  #endTimer: ReturnType<typeof setTimeout> | undefined;
  #usage: UsageType = { audioMs: 0, connectedMs: 0, minutesCharged: 0 };

  constructor(socket: WebSocket, created: LiveCreated, sampleRate: number) {
    this.id = created.id;
    this.#transcriptionId = created.transcriptionId;
    this.#socket = socket;
    this.#maxHeldBytes = sampleRate * 2 * HELD_AUDIO_SECONDS;
    // an unused rejection must not crash the process
    this.#opened.promise.catch(() => undefined);
    socket.addEventListener('open', () => {
      this.#opened.resolve();
    });
    socket.addEventListener('message', event => {
      this.#onMessage((event).data);
    });
    socket.addEventListener('error', () => {
      this.#onSocketError();
    });
    socket.addEventListener('close', () => {
      this.#onClose();
    });
  }

  get transcriptionId(): string | null {
    return this.#transcriptionId;
  }

  async waitForOpen(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      this.#abandon();
      throw buildAbortedError();
    }

    const onAbort = () => {
      this.#abandon();
      this.#opened.reject(buildAbortedError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.#opened.promise;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  on<K extends keyof LiveEvents>(event: K, handler: (payload: LiveEvents[K]) => void): () => void {
    return this.#emitter.on(event, handler);
  }

  send(audio: Int16Array | Uint8Array | ArrayBuffer): void {
    const bytes = toBytes(audio);
    if (bytes.byteLength % 2 !== 0) {
      throw new Transcript1Error(ERROR_CODES.invalid_input, 'Audio must be 16-bit samples: its length in bytes must be even');
    }

    if (this.#finished) {
      return;
    }

    for (let offset = 0; offset < bytes.byteLength; offset += MAX_FRAME_BYTES) {
      this.#dispatch({ kind: 'audio', data: bytes.subarray(offset, offset + MAX_FRAME_BYTES) });
    }
  }

  finalize(): void {
    if (!this.#finished) {
      this.#dispatch({ kind: 'finalize' });
    }
  }

  async end(): Promise<LiveEndResult> {
    if (!this.#finished && !this.#endTimer) {
      this.#endTimer = setTimeout(() => {
        this.#finish({ ...this.#usage, reason: 'disconnected', transcriptionId: this.#transcriptionId });
      }, END_TIMEOUT_MS);
      this.#dispatch({ kind: 'end' });
    }

    return this.#done.promise;
  }

  #dispatch(item: QueuedType): void {
    if (this.#started) {
      this.#transmit(item);
      return;
    }

    this.#queue.push(item);
    if (item.kind === 'audio') {
      this.#queuedBytes += item.data.byteLength;
      this.#trimQueue();
    }
  }

  // the server drops audio sent before it has authenticated the socket
  #trimQueue(): void {
    let excess = this.#queuedBytes - this.#maxHeldBytes;
    for (let index = 0; excess > 0 && index < this.#queue.length; index++) {
      const item = this.#queue[index];
      if (item?.kind !== 'audio') {
        continue;
      }

      const cut = Math.min(item.data.byteLength, excess + (excess % 2));
      this.#queuedBytes -= cut;
      excess -= cut;
      if (cut === item.data.byteLength) {
        this.#queue.splice(index, 1);
        index--;
      } else {
        item.data = item.data.subarray(cut);
      }
    }
  }

  #transmit(item: QueuedType): void {
    if (this.#socket.readyState !== SOCKET_OPEN) {
      return;
    }

    if (item.kind === 'audio') {
      this.#socket.send(item.data);
    } else if (item.kind === 'finalize') {
      this.#socket.send(FINALIZE_COMMAND);
    } else {
      this.#socket.send(END_COMMAND);
    }
  }

  #flush(): void {
    const queue = this.#queue;
    this.#queue = [];
    this.#queuedBytes = 0;
    for (const item of queue) {
      this.#transmit(item);
    }
  }

  #onMessage(data: unknown): void {
    if (this.#finished) {
      return;
    }

    const event = parseServerEvent(data);
    if (event) {
      this.#handle(event);
    }
  }

  #handle(event: ServerEvent): void {
    switch (event.type) {
      case 'started': {
        this.#transcriptionId = event.payload.transcriptionId ?? this.#transcriptionId;
        this.#started = true;
        this.#emitter.emit('started', event.payload);
        this.#flush();
        break;
      }

      case 'line': {
        upsertLine(this.lines, event.payload);
        this.#emitter.emit('line', event.payload);
        break;
      }

      case 'usage': {
        const { connectedMs, audioMs, minutesCharged } = event.payload;
        this.#usage = { connectedMs, audioMs, minutesCharged };
        this.#emitter.emit('usage', event.payload);
        break;
      }

      case 'warning': {
        this.#emitter.emit('warning', event.payload);
        break;
      }

      case 'error': {
        this.#emitter.emit('error', event.payload);
        break;
      }

      case 'reconnect': {
        this.#emitter.emit('reconnecting', { attempt: 1 });
        break;
      }

      case 'ended': {
        this.#finish(event.payload);
        break;
      }
    }
  }

  #onSocketError(): void {
    this.#opened.reject(new Transcript1Error(ERROR_CODES.network_error, 'Could not open the live WebSocket connection', { retryable: true }));
    if (!this.#finished) {
      this.#emitter.emit('error', { code: ERROR_CODES.network_error, message: 'The live WebSocket connection failed' });
    }
  }

  #onClose(): void {
    this.#opened.reject(new Transcript1Error(ERROR_CODES.network_error, 'The live WebSocket connection closed before it opened', { retryable: true }));
    this.#finish({ ...this.#usage, reason: 'disconnected', transcriptionId: this.#transcriptionId });
  }

  // the socket never became a session: drop it without an ended event
  #abandon(): void {
    this.#finished = true;
    this.#closeSocket();
  }

  #closeSocket(): void {
    try {
      this.#socket.close(CLOSE_NORMAL);
    } catch {
      // already closing
    }
  }

  #finish(result: LiveEndResult): void {
    if (this.#finished) {
      return;
    }

    this.#finished = true;
    clearTimeout(this.#endTimer);
    this.#queue = [];
    this.#queuedBytes = 0;
    this.#closeSocket();
    this.#emitter.emit('ended', result);
    this.#done.resolve(result);
  }
}

export const openSession = async (
  Ctor: typeof WebSocket,
  created: LiveCreated,
  sampleRate: number,
  signal?: AbortSignal,
): Promise<LiveSession> => {
  const socket = new Ctor(created.websocketUrl, [LIVE_PROTOCOL, created.token]);
  const session = new Session(socket, created, sampleRate);
  await session.waitForOpen(signal);

  return session;
};
