import { ERROR_CODES } from '../codes.js';
import { buildAbortedError, Transcript1Error } from '../errors.js';
import { createEmitter } from './emitter.js';
import { upsertLine } from './lines.js';
import type {
  LiveEndReason,
  LiveEndResult,
  LiveEvents,
  LiveLine,
  LiveSession,
  LiveSessionInfo,
} from './types.js';
import {
  END_COMMAND,
  FINALIZE_COMMAND,
  LIVE_PROTOCOL,
  MAX_FRAME_BYTES,
  parseServerEvent,
  type LiveCredentials,
  type ServerEvent,
} from './wire.js';

const SOCKET_OPEN = 1;
const HELD_AUDIO_SECONDS = 10;
const CLOSE_NORMAL = 1000;
const CLOSE_NOT_FOUND = 4004;
const CLOSE_PROTOCOL = 4008;
const CLOSE_REPLACED = 4010;
const ABNORMAL_CLOSE = 1006;
const CONNECT_TIMEOUT_MS = 10_000;

export const END_TIMEOUT_MS = 30_000;
export const RESUME_WINDOW_MS = 120_000;
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000];

const END_REASONS = new Set<string>([
  'client_ended',
  'balance_exhausted',
  'idle_timeout',
  'max_duration',
  'disconnected',
  'upstream_error',
  'internal_error',
]);

// a close with one of these will not be fixed by connecting again
const FINAL_CLOSE_CODES = new Set([CLOSE_NOT_FOUND, CLOSE_PROTOCOL, CLOSE_REPLACED]);

type QueuedType =
  | { kind: 'audio'; data: Uint8Array; mediaMs?: number }
  | { kind: 'finalize' }
  | { kind: 'position'; audioMs: number; mediaMs: number; inputAudioMs: number }
  | { kind: 'boundary'; audioMs: number; inputAudioMs: number };

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

export type SessionDeps = {
  Ctor: typeof WebSocket;
  sampleRate: number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  // POST /v1/live/sessions/:id/token
  requestToken: () => Promise<LiveCredentials>;
  // GET /v1/live/sessions/:id
  readInfo: () => Promise<LiveSessionInfo>;
};

type UsageType = Pick<LiveEvents['usage'], 'audioMs' | 'connectedMs' | 'minutesCharged'>;

type ConnectingType = {
  socket: WebSocket;
  done: DeferredType<void>;
};

type AttemptType = 'connected' | 'retry' | 'final';

class ConnectFailure extends Error {
  constructor(readonly closeCode: number | undefined, message: string) {
    super(message);
  }
}

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

// the server has already settled the session, or it never will: the session read is the record
const resultFromInfo = (info: LiveSessionInfo, fallback: LiveEndResult): LiveEndResult => {
  const known = info.status === 'ended' && END_REASONS.has(info.endReason ?? '');

  return {
    reason: known ? info.endReason as LiveEndReason : 'disconnected',
    transcriptionId: info.transcriptionId ?? fallback.transcriptionId,
    minutesCharged: info.minutesCharged,
    connectedMs: info.connectedMs,
    audioMs: info.audioMs,
  };
};

const isGone = (error: unknown): boolean => error instanceof Transcript1Error && (error.status === 404 || error.status === 409);

export class Session implements LiveSession {
  readonly lines: LiveLine[] = [];
  #transcriptionId: string | null;
  #socket: WebSocket | undefined;
  #connecting: ConnectingType | undefined;
  readonly #deps: SessionDeps;
  readonly #emitter = createEmitter<LiveEvents>();
  readonly #maxHeldBytes: number;
  readonly #done = createDeferred<LiveEndResult>();
  #queue: QueuedType[] = [];
  #queuedBytes = 0;
  #lastPosition = -1;
  #inputAudioMs = 0;
  #wireAudioMs = 0;
  #lastWirePosition = 0;
  #mediaAnchor: { audioMs: number; mediaMs: number } | undefined;
  #wireAnchor: { audioMs: number; mediaMs: number } | undefined;
  #ready = false;
  #captionBoundaries = false;
  #reconnecting = false;
  #settling = false;
  #finished = false;
  #endRequested = false;
  #endTimer: AbortController | undefined;
  #usage: UsageType = { audioMs: 0, connectedMs: 0, minutesCharged: 0 };
  #serverError = '';
  // events wait here until start() has handed the session to the caller
  #held: Array<() => void> | undefined = [];

  constructor(readonly id: string, transcriptionId: string | null, deps: SessionDeps) {
    this.#transcriptionId = transcriptionId;
    this.#deps = deps;
    this.#maxHeldBytes = deps.sampleRate * 2 * HELD_AUDIO_SECONDS;
  }

  get transcriptionId(): string | null {
    return this.#transcriptionId;
  }

  // the first connection: resolves once the server has sent session.started
  async connect(credentials: LiveCredentials, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
      throw buildAbortedError();
    }

    const onAbort = () => {
      this.#connecting?.done.reject(buildAbortedError());
    };

    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      await this.#open(credentials);
    } catch (error: unknown) {
      this.#abandon();
      if (error instanceof ConnectFailure) {
        throw new Transcript1Error(ERROR_CODES.network_error, error.message, { retryable: true });
      }

      throw error;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }

    // the caller attaches its handlers right after start() resolves
    setTimeout(() => {
      this.#release();
    }, 0);
  }

  on<K extends keyof LiveEvents>(event: K, handler: (payload: LiveEvents[K]) => void): () => void {
    return this.#emitter.on(event, handler);
  }

  send(audio: Int16Array | Uint8Array | ArrayBuffer): void {
    const bytes = toBytes(audio);
    if (bytes.byteLength % 2 !== 0) {
      throw new Transcript1Error(ERROR_CODES.invalid_input, 'Audio must be 16-bit samples: its length in bytes must be even');
    }

    if (this.#finished || this.#endRequested) {
      return;
    }

    for (let offset = 0; offset < bytes.byteLength; offset += MAX_FRAME_BYTES) {
      const data = bytes.subarray(offset, offset + MAX_FRAME_BYTES);
      const mediaMs = this.#mediaAnchor
        ? this.#mediaAnchor.mediaMs + this.#inputAudioMs - this.#mediaAnchor.audioMs : undefined;
      this.#dispatch({ kind: 'audio', data, mediaMs });
      this.#inputAudioMs += data.byteLength / (this.#deps.sampleRate * 2) * 1000;
    }
  }

  finalize(): void {
    if (!this.#finished && !this.#endRequested) {
      this.#dispatch({ kind: 'finalize' });
    }
  }

  position(audioMs: number, mediaMs: number): void {
    if (this.#finished || this.#endRequested) {
      return;
    }

    if (!Number.isSafeInteger(audioMs) || !Number.isSafeInteger(mediaMs)
      || audioMs < Math.max(0, this.#lastPosition) || mediaMs < 0) {
      throw new RangeError('Invalid media position: non-negative integer times and non-decreasing audio time required');
    }

    this.#lastPosition = audioMs;
    this.#mediaAnchor = { audioMs, mediaMs };
    this.#dispatch({
      kind: 'position', audioMs, mediaMs, inputAudioMs: this.#inputAudioMs,
    });
  }

  boundary(audioMs: number): boolean {
    if (!Number.isSafeInteger(audioMs) || audioMs < 0) {
      throw new RangeError('Invalid caption boundary: a non-negative integer audio time is required');
    }

    if (this.#finished || this.#endRequested || !this.#captionBoundaries) {
      return false;
    }

    this.#dispatch({ kind: 'boundary', audioMs, inputAudioMs: this.#inputAudioMs });

    return true;
  }

  async end(): Promise<LiveEndResult> {
    if (!this.#finished && !this.#endRequested) {
      this.#endRequested = true;
      // mid-reconnect the command goes out with the replay, after the audio
      if (this.#canSend()) {
        this.#sendEnd();
      }
    }

    return this.#done.promise;
  }

  #emit<K extends keyof LiveEvents>(event: K, payload: LiveEvents[K]): void {
    if (this.#held) {
      this.#held.push(() => {
        this.#emitter.emit(event, payload);
      });
      return;
    }

    this.#emitter.emit(event, payload);
  }

  #release(): void {
    const held = this.#held ?? [];
    this.#held = undefined;
    for (const emit of held) {
      emit();
    }
  }

  async #open(credentials: LiveCredentials, timeoutMs?: number): Promise<void> {
    const socket = new this.#deps.Ctor(credentials.websocketUrl, [LIVE_PROTOCOL, credentials.token]);
    const connecting: ConnectingType = { socket, done: createDeferred<void>() };
    this.#connecting = connecting;
    connecting.done.promise.catch(() => undefined);
    socket.addEventListener('message', event => {
      this.#onMessage(socket, event.data);
    });
    socket.addEventListener('error', () => {
      this.#onSocketError(socket);
    });
    socket.addEventListener('close', event => {
      this.#onClose(socket, event.code);
    });
    const timer = timeoutMs === undefined ? undefined : setTimeout(() => {
      connecting.done.reject(new ConnectFailure(undefined, 'The live WebSocket connection timed out'));
    }, timeoutMs);
    try {
      await connecting.done.promise;
    } catch (error: unknown) {
      this.#discard(connecting);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  #discard(connecting: ConnectingType): void {
    if (this.#connecting === connecting) {
      this.#connecting = undefined;
    }

    this.#closeSocket(connecting.socket);
  }

  #canSend(): boolean {
    return this.#ready && this.#socket?.readyState === SOCKET_OPEN;
  }

  #dispatch(item: QueuedType): void {
    if (this.#canSend()) {
      this.#transmit(item);
      return;
    }

    this.#queue.push(item);
    if (item.kind === 'audio') {
      this.#queuedBytes += item.data.byteLength;
      this.#trimQueue();
    }
  }

  // while there is no connection only the last seconds of audio are worth keeping
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
        if (item.mediaMs !== undefined) {
          item.mediaMs += cut / (this.#deps.sampleRate * 2) * 1000;
        }
      }
    }
  }

  #transmit(item: QueuedType): void {
    if (item.kind === 'boundary') {
      // a resumed connection may not support it: the boundary is dropped
      if (this.#captionBoundaries) {
        this.#socket?.send(JSON.stringify({
          type: 'caption.boundary',
          audio_ms: Math.max(0, Math.round(item.audioMs - item.inputAudioMs + this.#wireAudioMs)),
        }));
      }

      return;
    }

    if (item.kind === 'position') {
      this.#sendPosition(Math.max(this.#wireAnchor?.audioMs ?? 0,
        Math.round(item.audioMs - item.inputAudioMs + this.#wireAudioMs)), item.mediaMs);
      return;
    }

    if (item.kind === 'audio') {
      if (item.mediaMs !== undefined && (!this.#wireAnchor
        || Math.abs(this.#wireAnchor.mediaMs + this.#wireAudioMs - this.#wireAnchor.audioMs - item.mediaMs) > 1)) {
        this.#sendPosition(Math.round(this.#wireAudioMs), Math.max(0, Math.round(item.mediaMs)));
      }

      this.#socket?.send(item.data);
      this.#wireAudioMs += item.data.byteLength / (this.#deps.sampleRate * 2) * 1000;
    } else {
      this.#socket?.send(FINALIZE_COMMAND);
    }
  }

  #sendPosition(audioMs: number, mediaMs: number): void {
    const position = Math.max(audioMs, this.#lastWirePosition);
    this.#lastWirePosition = position;
    this.#socket?.send(JSON.stringify({ type: 'media.position', audio_ms: position, media_ms: mediaMs }));
    this.#wireAnchor = { audioMs: position, mediaMs };
  }

  #sendEnd(): void {
    this.#socket?.send(END_COMMAND);
    this.#armEndTimer();
  }

  // session.ended should follow the end command; if it never does, the server's record decides
  #armEndTimer(): void {
    this.#endTimer?.abort();
    const controller = new AbortController();
    this.#endTimer = controller;
    this.#deps.sleep(END_TIMEOUT_MS, controller.signal).then(async () => this.#settle(), () => undefined);
  }

  #flush(): void {
    const queue = this.#queue;
    this.#queue = [];
    this.#queuedBytes = 0;
    for (const item of queue) {
      this.#transmit(item);
    }

    if (this.#endRequested) {
      this.#sendEnd();
    }
  }

  #onMessage(socket: WebSocket, data: unknown): void {
    if (this.#finished) {
      return;
    }

    // a retired socket is ignored, but the one the server is replacing still delivers its last lines
    if (socket !== this.#socket && socket !== this.#connecting?.socket) {
      return;
    }

    const event = parseServerEvent(data);
    if (event) {
      this.#handle(socket, event);
    }
  }

  #handle(socket: WebSocket, event: ServerEvent): void {
    switch (event.type) {
      case 'started': {
        this.#onStarted(socket, event.payload);
        break;
      }

      case 'line': {
        upsertLine(this.lines, event.payload);
        this.#emit('line', event.payload);
        break;
      }

      case 'usage': {
        const { connectedMs, audioMs, minutesCharged } = event.payload;
        this.#usage = { connectedMs, audioMs, minutesCharged };
        this.#emit('usage', event.payload);
        break;
      }

      case 'warning': {
        this.#emit('warning', event.payload);
        break;
      }

      case 'error': {
        this.#serverError = event.payload.message;
        this.#emit('error', event.payload);
        break;
      }

      case 'reconnect': {
        // the server is about to close this socket: connect again straight away
        if (socket === this.#socket && !this.#reconnecting && !this.#settling) {
          this.#ready = false;
          this.#reconnect(true).catch(() => {
            this.#finish(this.#fallbackResult());
          });
        }

        break;
      }

      case 'ended': {
        this.#finish(event.payload);
        break;
      }
    }
  }

  #onStarted(socket: WebSocket, payload: LiveEvents['started']): void {
    const connecting = this.#connecting;
    if (connecting?.socket !== socket) {
      return;
    }

    const previous = this.#socket;
    this.#connecting = undefined;
    this.#socket = socket;
    if (previous && previous !== socket) {
      this.#closeSocket(previous);
    }

    this.#transcriptionId = payload.transcriptionId ?? this.#transcriptionId;
    this.#wireAudioMs = payload.offsetMs;
    this.#captionBoundaries = payload.captionBoundaries === true;
    // Replay carries its own media timestamps, including any prefix removed by the ten-second buffer limit.
    this.#wireAnchor = undefined;
    this.#ready = true;
    this.#emit('started', payload);
    this.#flush();
    connecting.done.resolve();
  }

  #onSocketError(socket: WebSocket): void {
    // Node's built-in WebSocket can report a failed connection with an error and no close, so the error decides by itself
    if (socket === this.#connecting?.socket) {
      this.#serverError = this.#serverError || 'The live WebSocket connection failed';
    }

    this.#onClose(socket, ABNORMAL_CLOSE);
  }

  #onClose(socket: WebSocket, code: number): void {
    if (this.#finished) {
      return;
    }

    if (socket === this.#connecting?.socket) {
      const detail = this.#serverError ? `: ${this.#serverError}` : '';
      this.#connecting.done.reject(new ConnectFailure(code, `The live WebSocket connection closed before the session started (code ${String(code)})${detail}`));
      return;
    }

    if (socket !== this.#socket) {
      return;
    }

    this.#socket = undefined;
    this.#ready = false;
    this.#endTimer?.abort();
    if (this.#settling) {
      return;
    }

    if (FINAL_CLOSE_CODES.has(code)) {
      this.#settle().catch(() => undefined);
      return;
    }

    if (!this.#reconnecting) {
      this.#reconnect(false).catch(() => {
        this.#finish(this.#fallbackResult());
      });
    }
  }

  // backoff 0.5, 1, 2, 4, 8 s (then 8 s) until the window after the drop is over
  async #reconnect(immediate: boolean): Promise<void> {
    this.#reconnecting = true;
    const droppedAt = this.#deps.now();
    for (let attempt = 1; !this.#finished && !this.#settling; attempt++) {
      const elapsed = this.#deps.now() - droppedAt;
      if (elapsed >= RESUME_WINDOW_MS) {
        break;
      }

      this.#emit('reconnecting', { attempt });
      const step = attempt - (immediate ? 2 : 1);
      const delay = step < 0 ? 0 : BACKOFF_MS[Math.min(step, BACKOFF_MS.length - 1)] ?? 0;
      if (delay > 0) {
        // eslint-disable-next-line no-await-in-loop
        await this.#deps.sleep(Math.min(delay, RESUME_WINDOW_MS - elapsed));
        if (this.#finished || this.#settling) {
          return;
        }

        if (this.#deps.now() - droppedAt >= RESUME_WINDOW_MS) {
          break;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const outcome = await this.#attempt();
      if (outcome === 'connected') {
        this.#reconnecting = false;
        this.#emit('reconnected', {});
        return;
      }

      if (outcome === 'final') {
        break;
      }
    }

    this.#reconnecting = false;
    await this.#settle();
  }

  async #attempt(): Promise<AttemptType> {
    let credentials: LiveCredentials;
    try {
      credentials = await this.#deps.requestToken();
    } catch (error: unknown) {
      return isGone(error) ? 'final' : 'retry';
    }

    if (this.#finished || this.#settling) {
      return 'final';
    }

    try {
      await this.#open(credentials, CONNECT_TIMEOUT_MS);
    } catch (error: unknown) {
      return error instanceof ConnectFailure && error.closeCode === CLOSE_NOT_FOUND ? 'final' : 'retry';
    }

    return 'connected';
  }

  #fallbackResult(): LiveEndResult {
    return { ...this.#usage, reason: 'disconnected', transcriptionId: this.#transcriptionId };
  }

  // the client cannot tell how the session ended, so ask the server once
  async #settle(): Promise<void> {
    if (this.#finished || this.#settling) {
      return;
    }

    this.#settling = true;
    let result = this.#fallbackResult();
    try {
      result = resultFromInfo(await this.#deps.readInfo(), result);
    } catch {
      // the last usage event is the best record left
    }

    this.#finish(result);
  }

  // the first socket never became a session: drop it without an ended event
  #abandon(): void {
    this.#finished = true;
    this.#held = undefined;
    this.#closeSocket(this.#socket);
    this.#closeSocket(this.#connecting?.socket);
  }

  #closeSocket(socket: WebSocket | undefined): void {
    try {
      socket?.close(CLOSE_NORMAL);
    } catch {
      // already closing
    }
  }

  #finish(result: LiveEndResult): void {
    if (this.#finished) {
      return;
    }

    this.#finished = true;
    this.#endTimer?.abort();
    this.#queue = [];
    this.#queuedBytes = 0;
    this.#connecting?.done.reject(new ConnectFailure(undefined, 'The live session ended'));
    this.#closeSocket(this.#connecting?.socket);
    this.#closeSocket(this.#socket);
    this.#emit('ended', result);
    this.#done.resolve(result);
  }
}

export const openSession = async (
  deps: SessionDeps,
  created: { id: string; transcriptionId: string | null } & LiveCredentials,
  signal?: AbortSignal,
): Promise<LiveSession> => {
  const session = new Session(created.id, created.transcriptionId, deps);
  await session.connect(created, signal);

  return session;
};
