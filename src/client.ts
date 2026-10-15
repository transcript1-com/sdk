import { getAccount } from './account.js';
import { resolveConfig, type ClientOptions, type ConfigType } from './config.js';
import { download } from './download.js';
import { transcribe } from './transcribe.js';
import { create } from './transcriptions/create.js';
import { remove } from './transcriptions/delete.js';
import { get } from './transcriptions/get.js';
import { list } from './transcriptions/list.js';
import type { GetOptions, ListParams } from './transcriptions/types.js';
import type {
  Account,
  CompletedTranscription,
  CreateOptions,
  DownloadOptions,
  Input,
  Transcription,
  TranscriptionSummary,
} from './types.js';

export type Transcriptions = {
  create: (input: Input, options?: CreateOptions) => Promise<Transcription>;
  get: (id: string, options?: GetOptions) => Promise<Transcription>;
  list: (params?: ListParams) => AsyncGenerator<TranscriptionSummary>;
  delete: (id: string, options?: { signal?: AbortSignal }) => Promise<void>;
};

const createTranscriptions = (config: ConfigType): Transcriptions => ({
  create: async (input, options) => create(config, input, options),
  get: async (id, options) => get(config, id, options),
  list: params => list(config, params),
  delete: async (id, options) => remove(config, id, options?.signal),
});

export class Transcript1 {
  readonly transcriptions: Transcriptions;
  readonly #config: ConfigType;

  constructor(options: ClientOptions = {}) {
    this.#config = resolveConfig(options);
    this.transcriptions = createTranscriptions(this.#config);
  }

  async transcribe(input: Input, options?: CreateOptions): Promise<CompletedTranscription> {
    return transcribe(this.#config, input, options);
  }

  async download(id: string, options?: DownloadOptions): Promise<string> {
    return download(this.#config, id, options);
  }

  async account(options?: { signal?: AbortSignal }): Promise<Account> {
    return getAccount(this.#config, options?.signal);
  }
}
