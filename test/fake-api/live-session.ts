import type { WebSocket } from 'ws';

export type FakeLiveSessionType = {
  id: string;
  transcriptionId: string | null;
  options: Record<string, unknown>;
  token: string;
  tokenUsed: boolean;
  socket: WebSocket | undefined;
  protocols: string[];
  frames: Buffer[];
  commands: string[];
  started: boolean;
  // how many sockets have authenticated; above 1 means the session was resumed
  connections: number;
  ended: boolean;
  closeCode: number | undefined;
  createdAt: Date;
  // send a server event as a JSON text frame
  emit: (event: Record<string, unknown>) => void;
  // send session.started
  start: (extra?: Record<string, unknown>) => void;
  // send session.ended and close with 1000
  finish: (reason?: string, extra?: Record<string, unknown>) => void;
  // close the socket without session.ended
  drop: (code?: number) => void;
};
