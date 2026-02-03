import { RateLimitConfig, RateLimitInfo, RateLimitState } from '../core/types.js';
import { sleep } from './retry.js';

export { sleep };

/**
 * Default rate limit configuration
 */
export const DEFAULT_RATE_LIMIT_CONFIG: Required<Omit<RateLimitConfig, 'parseRateLimitHeaders' | 'onRateLimitHit'>> &
  Pick<RateLimitConfig, 'parseRateLimitHeaders' | 'onRateLimitHit'> = {
  requestsPerSecond: 0,
  respectRetryAfter: true,
  maxRateLimitDelay: 60000,
  minRequestInterval: 0,
  parseRateLimitHeaders: undefined,
  onRateLimitHit: undefined,
};

/**
 * Merges user rate limit config with defaults
 */
export function mergeRateLimitConfig(
  config?: RateLimitConfig
): typeof DEFAULT_RATE_LIMIT_CONFIG {
  return {
    ...DEFAULT_RATE_LIMIT_CONFIG,
    ...config,
  };
}

/**
 * Creates initial rate limit state
 */
export function createRateLimitState(): RateLimitState {
  return {
    lastRequestTime: 0,
    currentLimitInfo: null,
  };
}

/**
 * Parses standard rate limit headers from API response
 * Supports common header formats:
 * - X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset (GitHub, Twitter, etc.)
 * - X-Rate-Limit-Limit, X-Rate-Limit-Remaining, X-Rate-Limit-Reset (alternative format)
 * - RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset (IETF draft)
 * - Retry-After (RFC 7231)
 */
export function parseStandardRateLimitHeaders(
  headers: Record<string, string>
): RateLimitInfo | null {
  const normalizedHeaders: Record<string, string> = {};

  // Normalize header names to lowercase
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key.toLowerCase()] = value;
  }

  const limit = parseIntHeader(normalizedHeaders, [
    'x-ratelimit-limit',
    'x-rate-limit-limit',
    'ratelimit-limit',
  ]);

  const remaining = parseIntHeader(normalizedHeaders, [
    'x-ratelimit-remaining',
    'x-rate-limit-remaining',
    'ratelimit-remaining',
  ]);

  const reset = parseResetHeader(normalizedHeaders, [
    'x-ratelimit-reset',
    'x-rate-limit-reset',
    'ratelimit-reset',
  ]);

  const retryAfter = parseRetryAfterHeader(normalizedHeaders['retry-after']);

  // Return null if no rate limit info found
  if (limit === undefined && remaining === undefined && reset === undefined && retryAfter === undefined) {
    return null;
  }

  return {
    limit,
    remaining,
    reset,
    retryAfter,
  };
}

/**
 * Parses an integer header value from multiple possible header names
 */
function parseIntHeader(
  headers: Record<string, string>,
  headerNames: string[]
): number | undefined {
  for (const name of headerNames) {
    const value = headers[name];
    if (value !== undefined) {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Parses reset header which can be Unix timestamp or seconds until reset
 */
function parseResetHeader(
  headers: Record<string, string>,
  headerNames: string[]
): number | undefined {
  for (const name of headerNames) {
    const value = headers[name];
    if (value !== undefined) {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        // If the value is less than a reasonable timestamp (e.g., year 2000),
        // treat it as seconds from now, otherwise as Unix timestamp
        if (parsed < 946684800) {
          // Less than year 2000 timestamp, treat as seconds
          return Math.floor(Date.now() / 1000) + parsed;
        }
        return parsed;
      }
    }
  }
  return undefined;
}

/**
 * Parses Retry-After header (RFC 7231)
 * Can be either seconds or HTTP-date
 */
function parseRetryAfterHeader(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  // Try parsing as number of seconds
  const seconds = parseInt(value, 10);
  if (!isNaN(seconds)) {
    return seconds;
  }

  // Try parsing as HTTP-date
  const date = new Date(value);
  if (!isNaN(date.getTime())) {
    const secondsUntil = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
    return secondsUntil;
  }

  return undefined;
}

/**
 * Calculates the delay needed before the next request based on throttling config
 */
export function calculateThrottleDelay(
  config: typeof DEFAULT_RATE_LIMIT_CONFIG,
  state: RateLimitState
): number {
  if (state.lastRequestTime === 0) {
    return 0;
  }

  let minInterval = config.minRequestInterval;

  // Calculate interval from requestsPerSecond if set and minRequestInterval not explicitly set
  if (config.requestsPerSecond > 0 && config.minRequestInterval === 0) {
    minInterval = Math.ceil(1000 / config.requestsPerSecond);
  }

  if (minInterval <= 0) {
    return 0;
  }

  const elapsed = Date.now() - state.lastRequestTime;
  const delay = Math.max(0, minInterval - elapsed);

  return delay;
}

/**
 * Calculates the delay needed when rate limited (429 response)
 */
export function calculateRateLimitDelay(
  config: typeof DEFAULT_RATE_LIMIT_CONFIG,
  rateLimitInfo: RateLimitInfo | null,
  statusCode: number
): number {
  if (statusCode !== 429) {
    return 0;
  }

  let delayMs = 0;

  if (rateLimitInfo && config.respectRetryAfter) {
    // Use Retry-After header if available
    if (rateLimitInfo.retryAfter !== undefined) {
      delayMs = rateLimitInfo.retryAfter * 1000;
    }
    // Otherwise calculate from reset timestamp
    else if (rateLimitInfo.reset !== undefined) {
      const resetTime = rateLimitInfo.reset * 1000;
      delayMs = Math.max(0, resetTime - Date.now());
    }
  }

  // If no delay calculated, use a default backoff
  if (delayMs === 0) {
    delayMs = 1000; // Default 1 second if no header info
  }

  // Cap at max delay
  return Math.min(delayMs, config.maxRateLimitDelay);
}

/**
 * Checks if we should proactively wait based on remaining rate limit
 */
export function shouldPreemptiveWait(
  rateLimitInfo: RateLimitInfo | null
): boolean {
  if (!rateLimitInfo) {
    return false;
  }

  // If remaining is 0 or 1, we should wait before next request
  return rateLimitInfo.remaining !== undefined && rateLimitInfo.remaining <= 1;
}

/**
 * Calculates preemptive wait time when rate limit is about to be exhausted
 */
export function calculatePreemptiveDelay(
  rateLimitInfo: RateLimitInfo | null,
  maxDelay: number
): number {
  if (!rateLimitInfo || rateLimitInfo.remaining === undefined || rateLimitInfo.remaining > 1) {
    return 0;
  }

  if (rateLimitInfo.reset !== undefined) {
    const resetTime = rateLimitInfo.reset * 1000;
    const delay = Math.max(0, resetTime - Date.now());
    return Math.min(delay, maxDelay);
  }

  if (rateLimitInfo.retryAfter !== undefined) {
    return Math.min(rateLimitInfo.retryAfter * 1000, maxDelay);
  }

  return 0;
}

