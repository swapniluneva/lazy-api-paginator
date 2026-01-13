import { describe, it, expect, vi } from 'vitest';
import {
  calculateBackoffDelay,
  shouldRetry,
  mergeRetryConfig,
  withRetry,
  sleep,
  DEFAULT_RETRY_CONFIG,
} from './retry.js';
import { HttpError } from './types.js';

describe('Retry utilities', () => {
  describe('mergeRetryConfig', () => {
    it('should return defaults when no config provided', () => {
      const config = mergeRetryConfig();
      expect(config).toEqual(DEFAULT_RETRY_CONFIG);
    });

    it('should merge custom config with defaults', () => {
      const config = mergeRetryConfig({ maxRetries: 5, initialDelay: 500 });
      expect(config.maxRetries).toBe(5);
      expect(config.initialDelay).toBe(500);
      expect(config.maxDelay).toBe(DEFAULT_RETRY_CONFIG.maxDelay);
    });
  });

  describe('calculateBackoffDelay', () => {
    it('should calculate exponential delays', () => {
      const config = mergeRetryConfig({ initialDelay: 1000, backoffMultiplier: 2, jitter: 0 });

      // With jitter = 0, delays should be exact
      const delay0 = calculateBackoffDelay(0, config);
      const delay1 = calculateBackoffDelay(1, config);
      const delay2 = calculateBackoffDelay(2, config);

      expect(delay0).toBe(1000); // 1000 * 2^0 = 1000
      expect(delay1).toBe(2000); // 1000 * 2^1 = 2000
      expect(delay2).toBe(4000); // 1000 * 2^2 = 4000
    });

    it('should cap at maxDelay', () => {
      const config = mergeRetryConfig({
        initialDelay: 1000,
        backoffMultiplier: 2,
        maxDelay: 5000,
        jitter: 0,
      });

      const delay = calculateBackoffDelay(10, config); // Would be 1024000 without cap
      expect(delay).toBe(5000);
    });

    it('should add jitter when configured', () => {
      const config = mergeRetryConfig({ initialDelay: 1000, jitter: 0.5, backoffMultiplier: 2 });

      const delays = new Set<number>();
      for (let i = 0; i < 10; i++) {
        delays.add(calculateBackoffDelay(0, config));
      }

      // With 50% jitter, delays should vary
      expect(delays.size).toBeGreaterThan(1);

      // All delays should be within jitter range (500-1500 for 1000 base)
      for (const delay of delays) {
        expect(delay).toBeGreaterThanOrEqual(500);
        expect(delay).toBeLessThanOrEqual(1500);
      }
    });
  });

  describe('shouldRetry', () => {
    it('should not retry when max retries exceeded', () => {
      const config = mergeRetryConfig({ maxRetries: 3 });
      const error = new HttpError('test', 500, 'Error');

      expect(shouldRetry(error, 3, config)).toBe(false);
      expect(shouldRetry(error, 4, config)).toBe(false);
    });

    it('should retry on retryable HTTP status codes', () => {
      const config = mergeRetryConfig({ retryableStatusCodes: [500, 502, 503] });

      expect(shouldRetry(new HttpError('test', 500, 'Error'), 0, config)).toBe(true);
      expect(shouldRetry(new HttpError('test', 502, 'Error'), 0, config)).toBe(true);
      expect(shouldRetry(new HttpError('test', 400, 'Error'), 0, config)).toBe(false);
    });

    it('should retry on network errors by default', () => {
      const config = mergeRetryConfig();

      const networkError = new Error('ECONNRESET');
      expect(shouldRetry(networkError, 0, config)).toBe(true);

      const fetchError = new Error('fetch failed');
      expect(shouldRetry(fetchError, 0, config)).toBe(true);
    });

    it('should use custom isRetryable function', () => {
      const config = mergeRetryConfig({
        isRetryable: (error, statusCode) => statusCode === 418,
      });

      expect(shouldRetry(new HttpError('test', 418, 'Teapot'), 0, config)).toBe(true);
    });
  });

  describe('sleep', () => {
    it('should wait for specified duration', async () => {
      const start = Date.now();
      await sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40); // Allow some tolerance
    });
  });

  describe('withRetry', () => {
    it('should return result on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const config = mergeRetryConfig();

      const result = await withRetry(fn, config);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');
      const config = mergeRetryConfig({ initialDelay: 10 });

      const result = await withRetry(fn, config);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should call onRetry callback', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('ECONNRESET'))
        .mockResolvedValue('success');
      const config = mergeRetryConfig({ initialDelay: 10 });
      const onRetry = vi.fn();

      await withRetry(fn, config, onRetry);

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 0, expect.any(Number));
    });

    it('should throw after max retries', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
      const config = mergeRetryConfig({ maxRetries: 2, initialDelay: 10 });

      await expect(withRetry(fn, config)).rejects.toThrow('ECONNRESET');
      expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn().mockRejectedValue(new HttpError('test', 400, 'Bad Request'));
      const config = mergeRetryConfig({ initialDelay: 10 });

      await expect(withRetry(fn, config)).rejects.toThrow(HttpError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
