import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseStandardRateLimitHeaders,
  calculateThrottleDelay,
  calculateRateLimitDelay,
  calculatePreemptiveDelay,
  shouldPreemptiveWait,
  mergeRateLimitConfig,
  createRateLimitState,
  DEFAULT_RATE_LIMIT_CONFIG,
} from '../utils/rate-limit.js';

describe('Rate limit utilities', () => {
  describe('mergeRateLimitConfig', () => {
    it('should return defaults when no config provided', () => {
      const config = mergeRateLimitConfig();
      expect(config.requestsPerSecond).toBe(0);
      expect(config.respectRetryAfter).toBe(true);
      expect(config.maxRateLimitDelay).toBe(60000);
      expect(config.minRequestInterval).toBe(0);
    });

    it('should merge custom config with defaults', () => {
      const config = mergeRateLimitConfig({
        requestsPerSecond: 10,
        maxRateLimitDelay: 30000,
      });
      expect(config.requestsPerSecond).toBe(10);
      expect(config.maxRateLimitDelay).toBe(30000);
      expect(config.respectRetryAfter).toBe(true);
    });
  });

  describe('createRateLimitState', () => {
    it('should create initial state', () => {
      const state = createRateLimitState();
      expect(state.lastRequestTime).toBe(0);
      expect(state.currentLimitInfo).toBeNull();
    });
  });

  describe('parseStandardRateLimitHeaders', () => {
    it('should parse X-RateLimit-* headers', () => {
      const headers = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '50',
        'X-RateLimit-Reset': '1700000000',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info).toEqual({
        limit: 100,
        remaining: 50,
        reset: 1700000000,
        retryAfter: undefined,
      });
    });

    it('should parse X-Rate-Limit-* headers (hyphenated)', () => {
      const headers = {
        'X-Rate-Limit-Limit': '200',
        'X-Rate-Limit-Remaining': '25',
        'X-Rate-Limit-Reset': '1700000000',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info).toEqual({
        limit: 200,
        remaining: 25,
        reset: 1700000000,
        retryAfter: undefined,
      });
    });

    it('should parse RateLimit-* headers (IETF draft)', () => {
      const headers = {
        'RateLimit-Limit': '1000',
        'RateLimit-Remaining': '999',
        'RateLimit-Reset': '1700000000',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info).toEqual({
        limit: 1000,
        remaining: 999,
        reset: 1700000000,
        retryAfter: undefined,
      });
    });

    it('should parse Retry-After header (seconds)', () => {
      const headers = {
        'Retry-After': '60',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info?.retryAfter).toBe(60);
    });

    it('should parse Retry-After header (HTTP date)', () => {
      const futureDate = new Date(Date.now() + 30000); // 30 seconds from now
      const headers = {
        'Retry-After': futureDate.toUTCString(),
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info?.retryAfter).toBeGreaterThan(25);
      expect(info?.retryAfter).toBeLessThanOrEqual(31);
    });

    it('should return null when no rate limit headers found', () => {
      const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info).toBeNull();
    });

    it('should handle case-insensitive headers', () => {
      const headers = {
        'x-ratelimit-limit': '100',
        'x-ratelimit-remaining': '50',
      };

      const info = parseStandardRateLimitHeaders(headers);

      expect(info?.limit).toBe(100);
      expect(info?.remaining).toBe(50);
    });

    it('should treat small reset values as seconds from now', () => {
      const headers = {
        'X-RateLimit-Reset': '60', // 60 seconds
      };

      const now = Math.floor(Date.now() / 1000);
      const info = parseStandardRateLimitHeaders(headers);

      expect(info?.reset).toBeGreaterThanOrEqual(now + 59);
      expect(info?.reset).toBeLessThanOrEqual(now + 61);
    });
  });

  describe('calculateThrottleDelay', () => {
    it('should return 0 for first request', () => {
      const config = mergeRateLimitConfig({ requestsPerSecond: 10 });
      const state = createRateLimitState();

      const delay = calculateThrottleDelay(config, state);

      expect(delay).toBe(0);
    });

    it('should calculate delay based on requestsPerSecond', () => {
      const config = mergeRateLimitConfig({ requestsPerSecond: 10 });
      const state = createRateLimitState();
      state.lastRequestTime = Date.now();

      const delay = calculateThrottleDelay(config, state);

      // 10 requests/sec = 100ms interval
      expect(delay).toBe(100);
    });

    it('should use minRequestInterval when set', () => {
      const config = mergeRateLimitConfig({
        requestsPerSecond: 10,
        minRequestInterval: 200,
      });
      const state = createRateLimitState();
      state.lastRequestTime = Date.now();

      const delay = calculateThrottleDelay(config, state);

      expect(delay).toBe(200);
    });

    it('should account for elapsed time', () => {
      const config = mergeRateLimitConfig({ requestsPerSecond: 10 });
      const state = createRateLimitState();
      state.lastRequestTime = Date.now() - 50; // 50ms ago

      const delay = calculateThrottleDelay(config, state);

      // 100ms interval - 50ms elapsed = 50ms delay
      expect(delay).toBe(50);
    });

    it('should return 0 when enough time has passed', () => {
      const config = mergeRateLimitConfig({ requestsPerSecond: 10 });
      const state = createRateLimitState();
      state.lastRequestTime = Date.now() - 200; // 200ms ago

      const delay = calculateThrottleDelay(config, state);

      expect(delay).toBe(0);
    });

    it('should return 0 when throttling disabled', () => {
      const config = mergeRateLimitConfig({ requestsPerSecond: 0 });
      const state = createRateLimitState();
      state.lastRequestTime = Date.now();

      const delay = calculateThrottleDelay(config, state);

      expect(delay).toBe(0);
    });
  });

  describe('calculateRateLimitDelay', () => {
    it('should return 0 for non-429 status', () => {
      const config = mergeRateLimitConfig();

      const delay = calculateRateLimitDelay(config, null, 200);

      expect(delay).toBe(0);
    });

    it('should use Retry-After header for 429', () => {
      const config = mergeRateLimitConfig();
      const rateLimitInfo = { retryAfter: 30 };

      const delay = calculateRateLimitDelay(config, rateLimitInfo, 429);

      expect(delay).toBe(30000);
    });

    it('should calculate delay from reset timestamp', () => {
      const config = mergeRateLimitConfig();
      const resetTime = Math.floor(Date.now() / 1000) + 10; // 10 seconds from now
      const rateLimitInfo = { reset: resetTime };

      const delay = calculateRateLimitDelay(config, rateLimitInfo, 429);

      expect(delay).toBeGreaterThanOrEqual(9000);
      expect(delay).toBeLessThanOrEqual(11000);
    });

    it('should use default delay when no headers', () => {
      const config = mergeRateLimitConfig();

      const delay = calculateRateLimitDelay(config, null, 429);

      expect(delay).toBe(1000);
    });

    it('should cap at maxRateLimitDelay', () => {
      const config = mergeRateLimitConfig({ maxRateLimitDelay: 5000 });
      const rateLimitInfo = { retryAfter: 120 }; // 120 seconds

      const delay = calculateRateLimitDelay(config, rateLimitInfo, 429);

      expect(delay).toBe(5000);
    });

    it('should return default delay when respectRetryAfter is false', () => {
      const config = mergeRateLimitConfig({ respectRetryAfter: false });
      const rateLimitInfo = { retryAfter: 120 };

      const delay = calculateRateLimitDelay(config, rateLimitInfo, 429);

      // Should use default 1 second delay instead of header value
      expect(delay).toBe(1000);
    });
  });

  describe('shouldPreemptiveWait', () => {
    it('should return false when no rate limit info', () => {
      expect(shouldPreemptiveWait(null)).toBe(false);
    });

    it('should return false when remaining is high', () => {
      expect(shouldPreemptiveWait({ remaining: 10 })).toBe(false);
      expect(shouldPreemptiveWait({ remaining: 5 })).toBe(false);
    });

    it('should return true when remaining is 0 or 1', () => {
      expect(shouldPreemptiveWait({ remaining: 0 })).toBe(true);
      expect(shouldPreemptiveWait({ remaining: 1 })).toBe(true);
    });

    it('should return false when remaining is undefined', () => {
      expect(shouldPreemptiveWait({ limit: 100 })).toBe(false);
    });
  });

  describe('calculatePreemptiveDelay', () => {
    it('should return 0 when no preemptive wait needed', () => {
      const delay = calculatePreemptiveDelay({ remaining: 10 }, 60000);
      expect(delay).toBe(0);
    });

    it('should return 0 when rate limit info is null', () => {
      const delay = calculatePreemptiveDelay(null, 60000);
      expect(delay).toBe(0);
    });

    it('should calculate delay from reset timestamp when remaining is low', () => {
      const resetTime = Math.floor(Date.now() / 1000) + 10;
      const delay = calculatePreemptiveDelay({ remaining: 0, reset: resetTime }, 60000);

      expect(delay).toBeGreaterThanOrEqual(9000);
      expect(delay).toBeLessThanOrEqual(11000);
    });

    it('should use retryAfter when available', () => {
      const delay = calculatePreemptiveDelay({ remaining: 1, retryAfter: 5 }, 60000);
      expect(delay).toBe(5000);
    });

    it('should cap at maxDelay', () => {
      const delay = calculatePreemptiveDelay({ remaining: 0, retryAfter: 120 }, 10000);
      expect(delay).toBe(10000);
    });
  });
});
