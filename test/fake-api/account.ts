import type { Account } from '../../src/types.js';
import { sendJson, type HandlerType } from './http.js';

const UNLIMITED_MINUTES = 1000;
const DEFAULT_ACTIVE_JOBS = 10;

const getMinutes = (minutesLeft: number): number => {
  if (minutesLeft < 0) {
    return UNLIMITED_MINUTES;
  }

  return minutesLeft;
};

const getActiveJobs = (activeLimit: number): number => {
  if (activeLimit > 0) {
    return activeLimit;
  }

  return DEFAULT_ACTIVE_JOBS;
};

export const account: HandlerType = context => {
  const { state, res } = context;
  const { minutesLeft, activeLimit } = state.knobs;
  const body: Account = {
    object: 'account',
    user: { id: 'u_1', email: 'demo@transcript1.com' },
    plan: { id: 'monthly', name: 'Monthly' },
    minutes: {
      remaining: getMinutes(minutesLeft),
      cycle: getMinutes(minutesLeft),
      topup: 0,
      topup_usable: true,
      resets_at: null,
    },
    renews_at: null,
    limits: {
      requests_per_minute: 200,
      max_active_jobs: getActiveJobs(activeLimit),
    },
  };
  sendJson(res, 200, body);
};
