import type { ConfigType } from '../config.js';
import { buildAbortedError } from '../errors.js';
import { request } from '../http/request.js';
import type { LinkInputType } from '../inputs/types.js';
import { isSlotBusy } from '../slot-busy.js';
import type { CreateOptions, Transcription } from '../types.js';
import { createSlotWaiter, type WaitSlotType } from './wait-slot.js';

type LinkBodyType = {
  platform: 'youtube';
  url: string;
  source?: CreateOptions['source'];
  language?: string;
  diarize?: true;
};

type LinkOptionsType = CreateOptions & { idempotencyKey: string };

type QueryType = {
  wait: number;
  reuse_recent?: boolean;
};

const buildLinkBody = (link: LinkInputType, options: CreateOptions): LinkBodyType => {
  const body: LinkBodyType = { platform: 'youtube', url: link.url };
  if (options.source) {
    body.source = options.source;
  }

  if (options.language) {
    body.language = options.language;
  }

  if (options.speakers) {
    body.diarize = true;
  }

  return body;
};

const buildQuery = (options: CreateOptions): QueryType => {
  const query: QueryType = { wait: 0 };
  if (!options.fresh) {
    query.reuse_recent = true;
  }

  return query;
};

const sendCreate = async (config: ConfigType, body: LinkBodyType, options: LinkOptionsType, waitSlot: WaitSlotType): Promise<Transcription> => {
  try {
    const created = await request(config, {
      method: 'POST',
      path: '/v1/transcriptions',
      query: buildQuery(options),
      body,
      headers: { 'Idempotency-Key': options.idempotencyKey },
      signal: options.signal,
      retry429: false,
    });

    return created.json as Transcription;
  } catch (error: unknown) {
    if (!isSlotBusy(error)) {
      throw error;
    }

    await waitSlot(error, options.signal);
    if (options.signal?.aborted) {
      throw buildAbortedError();
    }

    return sendCreate(config, body, options, waitSlot);
  }
};

export const createLink = async (config: ConfigType, link: LinkInputType, options: LinkOptionsType): Promise<Transcription> => {
  const waitSlot = createSlotWaiter(config, options.onProgress);

  return sendCreate(config, buildLinkBody(link, options), options, waitSlot);
};
