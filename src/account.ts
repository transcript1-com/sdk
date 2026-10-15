import type { ConfigType } from './config.js';
import { request } from './http/request.js';
import type { Account } from './types.js';

export const getAccount = async (config: ConfigType, signal?: AbortSignal): Promise<Account> => {
  const response = await request(config, { method: 'GET', path: '/v1/account', signal });

  return response.json as Account;
};
