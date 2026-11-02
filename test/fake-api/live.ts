import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { ERROR_CODES } from '../../src/codes.js';
import {
  isRecord,
  parseJson,
  sendError,
  sendJson,
  type HandlerType,
} from './http.js';
import type { FakeLiveSessionType } from './live-session.js';
import type { StateType } from './state.js';

const MAX_FRAME = 262_144;
const SESSION_PATH = /^\/v1\/live\/sessions\/(?<id>[^/]+)\/stream$/;

const CAPABILITIES = {
  available: true,
  auto_language: true,
  languages: ['en', 'es', 'de'],
  translation: { targets: ['es', 'de'], pairs: 'any', requires_language: false },
  diarize: true,
  audio_formats: ['pcm_s16le'],
  sample_rate: { min: 8000, max: 48_000 },
  max_session_minutes: 300,
  rate: 1,
};

const sendKnobError = (context: Parameters<HandlerType>[0]): boolean => {
  const { state, res } = context;
  const knob = state.knobs.liveError;
  if (!knob) {
    return false;
  }

  const headers: Record<string, string> = {};
  if (knob.retryAfter !== undefined) {
    headers['Retry-After'] = String(knob.retryAfter);
  }

  const extra = { ...knob.extra, ...(knob.retryable === undefined ? {} : { retryable: knob.retryable }) };
  sendError(res, knob.status, knob.code, knob.message ?? knob.code, { extra, headers });
  return true;
};

const buildOptions = (body: Record<string, unknown>): Record<string, unknown> => ({
  language: body.language ?? 'auto',
  translate_to: body.translate_to ?? null,
  diarize: body.diarize ?? false,
  audio_format: 'pcm_s16le',
  sample_rate: body.sample_rate ?? 16_000,
  save: body.save ?? true,
});

const newSession = (state: StateType, options: Record<string, unknown>): FakeLiveSessionType => {
  const id = `lv_${String(state.liveSessions.size + 1)}`;
  const session: FakeLiveSessionType = {
    id,
    transcriptionId: options.save === false ? null : `tr_live_${String(state.liveSessions.size + 1)}`,
    options,
    token: randomBytes(16).toString('base64url'),
    tokenUsed: false,
    socket: undefined,
    protocols: [],
    frames: [],
    commands: [],
    started: false,
    ended: false,
    closeCode: undefined,
    createdAt: new Date(),
    emit(event) {
      session.socket?.send(JSON.stringify(event));
    },
    start(extra = {}) {
      session.started = true;
      session.emit({
        type: 'session.started',
        session_id: id,
        transcription_id: session.transcriptionId,
        resumed: false,
        offset_ms: 0,
        ...extra,
      });
    },
    finish(reason = 'client_ended', extra = {}) {
      session.ended = true;
      session.emit({
        type: 'session.ended',
        reason,
        transcription_id: session.transcriptionId,
        minutes_charged: 1,
        connected_ms: 1500,
        audio_ms: 1000,
        ...extra,
      });
      session.socket?.close(1000);
    },
    drop(code = 1006) {
      if (code === 1006) {
        session.socket?.terminate();
        return;
      }

      session.socket?.close(code);
    },
  };
  state.liveSessions.set(id, session);

  return session;
};

export const createLiveSession: HandlerType = async context => {
  const { state, req, res } = context;
  if (sendKnobError(context)) {
    return;
  }

  const body = await parseJson(context);
  if (!body) {
    sendError(res, 400, ERROR_CODES.invalid_request, 'Request body is not valid JSON');
    return;
  }

  if (state.knobs.minutesLeft === 0) {
    sendError(res, 402, ERROR_CODES.insufficient_minutes, 'Not enough minutes', {
      extra: { minutes_needed: 1, minutes_remaining: 0, action_url: 'https://transcript1.com/dashboard/billing' },
    });
    return;
  }

  const session = newSession(state, buildOptions(body));
  const host = req.headers.host ?? '127.0.0.1';
  sendJson(res, 201, {
    id: session.id,
    status: 'waiting',
    transcription_id: session.transcriptionId,
    websocket_url: `ws://${host}${state.knobs.prefix}/v1/live/sessions/${session.id}/stream`,
    token: session.token,
    token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    rate: 1,
  });
};

export const getLiveSession: HandlerType = context => {
  const { state, res, params } = context;
  const session = state.liveSessions.get(params.id ?? '');
  if (!session) {
    sendError(res, 404, ERROR_CODES.not_found, 'Live session not found');
    return;
  }

  sendJson(res, 200, {
    id: session.id,
    status: session.ended ? 'ended' : 'connected',
    end_reason: session.ended ? 'client_ended' : null,
    transcription_id: session.transcriptionId,
    options: session.options,
    connected_ms: 1500,
    audio_ms: 1000,
    minutes_charged: 1,
    rate: 1,
    created_at: session.createdAt.toISOString(),
    ended_at: null,
  });
};

export const liveCapabilities: HandlerType = context => {
  sendJson(context.res, 200, CAPABILITIES);
};

const rejectFrame = (session: FakeLiveSessionType, socket: WebSocket, frame: Buffer) => {
  if (frame.length % 2 !== 0 || frame.length > MAX_FRAME) {
    socket.close(4008);
    return;
  }

  session.frames.push(frame);
};

type ConnectionType = {
  session: FakeLiveSessionType;
  socket: WebSocket;
  state: StateType;
};

const onMessage = ({ session, socket, state }: ConnectionType, data: Buffer, isBinary: boolean) => {
  if (isBinary) {
    rejectFrame(session, socket, data);
    return;
  }

  const text = data.toString('utf8');
  session.commands.push(text);
  const message: unknown = JSON.parse(text);
  if (isRecord(message) && message.type === 'end' && state.knobs.liveAutoEnd) {
    session.finish('client_ended');
  }
};

const connect = (state: StateType, socket: WebSocket, id: string, protocols: string[]) => {
  const [name, token] = protocols;
  const session = state.liveSessions.get(id);
  if (name !== 't1-live' || !session || session.token !== token || session.tokenUsed) {
    socket.send(JSON.stringify({ type: 'error', code: 'invalid_token', message: 'The token is invalid or was already used' }));
    socket.close(4001);
    return;
  }

  session.tokenUsed = true;
  session.socket = socket;
  session.protocols = protocols;
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    onMessage({ session, socket, state }, data, isBinary);
  });
  socket.on('close', code => {
    session.closeCode = code;
  });
  if (!state.knobs.liveManualStart) {
    session.start();
  }
};

export const attachLive = (server: Server, state: StateType): WebSocketServer => {
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1_048_576,
    handleProtocols: protocols => (protocols.has('t1-live') ? 't1-live' : false),
  });
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '/', 'http://fake-api.local');
    const path = url.pathname.slice(state.knobs.prefix.length);
    const id = SESSION_PATH.exec(path)?.groups?.id;
    if (!id) {
      socket.destroy();
      return;
    }

    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(item => item.trim());
    wss.handleUpgrade(req, socket, head, ws => {
      connect(state, ws, id, protocols);
    });
  });

  return wss;
};
