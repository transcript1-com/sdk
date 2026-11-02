type HandlerEntry = {
  handler: (payload: unknown) => void;
};

export type Emitter<Events extends Record<string, unknown>> = {
  on<K extends keyof Events>(event: K, handler: (payload: Events[K]) => void): () => void;
  emit<K extends keyof Events>(event: K, payload: Events[K]): void;
};

// a throwing handler must not stop the other handlers or the socket loop
const rethrowLater = (error: unknown) => {
  queueMicrotask(() => {
    throw error;
  });
};

export const createEmitter = <Events extends Record<string, unknown>>(): Emitter<Events> => {
  const entries = new Map<keyof Events, HandlerEntry[]>();

  return {
    on(event, handler) {
      const entry: HandlerEntry = { handler: handler as (payload: unknown) => void };
      entries.set(event, [...entries.get(event) ?? [], entry]);

      return () => {
        entries.set(event, (entries.get(event) ?? []).filter(item => item !== entry));
      };
    },
    emit(event, payload) {
      for (const entry of entries.get(event) ?? []) {
        try {
          entry.handler(payload);
        } catch (error: unknown) {
          rethrowLater(error);
        }
      }
    },
  };
};
