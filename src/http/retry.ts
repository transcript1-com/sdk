export const MAX_RETRY_AFTER_MS = 60_000;

const BASE_DELAY_MS = 1000;
const JITTER = 0.25;

export const isRetryableStatus = (status: number, retry429: boolean): boolean => {
  if (status === 429) {
    return retry429;
  }

  return [500, 502, 503, 504].includes(status);
};

const parseRetryAfter = (value: string): number => {
  if (/^\d+$/.test(value)) {
    return Number(value) * 1000;
  }

  return Date.parse(value) - Date.now();
};

// zero, past dates and garbage count as absent
export const retryAfterMs = (headers: Headers): number | undefined => {
  const value = headers.get('Retry-After')?.trim();
  if (!value) {
    return undefined;
  }

  const ms = parseRetryAfter(value);
  if (!Number.isFinite(ms)) {
    return undefined;
  }

  if (ms <= 0) {
    return undefined;
  }

  return ms;
};

export const retryDelayMs = (attempt: number, headers: Headers, random: () => number): number => {
  const wait = retryAfterMs(headers);
  if (wait !== undefined) {
    return Math.min(wait, MAX_RETRY_AFTER_MS);
  }

  const base = BASE_DELAY_MS * (2 ** attempt);

  return base + (random() * JITTER * base);
};
