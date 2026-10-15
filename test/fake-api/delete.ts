import type { ServerResponse } from 'node:http';
import type { HandlerType } from './http.js';
import {
  findOwnedJob,
  isTerminal,
  refund,
  removeJob,
} from './jobs.js';

const sendNoContent = (res: ServerResponse) => {
  res.writeHead(204);
  res.end();
};

export const remove: HandlerType = context => {
  const { state, res } = context;
  const job = findOwnedJob(context);
  if (!job) {
    return;
  }

  if (isTerminal(job.status)) {
    removeJob(state, job);
    sendNoContent(res);
    return;
  }

  job.status = 'canceled';
  job.token = '';
  job.completedAt = new Date();
  refund(state, job);
  sendNoContent(res);
};
