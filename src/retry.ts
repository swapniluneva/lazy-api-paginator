import { RetryConfig, HttpError } from './types.js';

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: 0.1,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  // Default: only retry if there's no status code (network errors)
  // HTTP errors are handled by retryableStatusCodes
  isRetryable: (_error: Error, statusCode?: number) => statusCode === undefined,
};

/**
 * Merges user config with defaults
 */
export function mergeRetryConfig(config?: RetryConfig): Required<RetryConfig> {
  return {
    ...DEFAULT_RETRY_CONFIG,
    ...config,
  };
}

/**
 * Calculates the delay for a given retry attempt using exponential backoff with jitter
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Required<RetryConfig>
): number {
  const { initialDelay, maxDelay, backoffMultiplier, jitter } = config;

  // Calculate exponential delay
  const exponentialDelay = initialDelay * Math.pow(backoffMultiplier, attempt);

  // Cap at max delay
  const cappedDelay = Math.min(exponentialDelay, maxDelay);

  // Add jitter (random factor between -jitter and +jitter)
  const jitterFactor = 1 + (Math.random() * 2 - 1) * jitter;
  const finalDelay = Math.floor(cappedDelay * jitterFactor);

  return Math.max(0, finalDelay);
}

/**
 * Determines if an error should trigger a retry
 */
export function shouldRetry(
  error: Error,
  attempt: number,
  config: Required<RetryConfig>
): boolean {
  // Check if we've exceeded max retries
  if (attempt >= config.maxRetries) {
    return false;
  }

  // Check for HTTP errors
  if (error instanceof HttpError) {
    // Check if status code is in the retryable list
    if (config.retryableStatusCodes.includes(error.status)) {
      return true;
    }
    // For HTTP errors with non-retryable status codes, use custom isRetryable
    // This allows users to override and make specific status codes retryable
    return config.isRetryable(error, error.status);
  }

  // Check network errors (these are typically retryable)
  if (isNetworkError(error)) {
    return config.isRetryable(error);
  }

  // For other errors, don't retry by default unless isRetryable says so
  return config.isRetryable(error, undefined);
}

/**
 * Checks if an error is a network-related error
 */
function isNetworkError(error: Error): boolean {
  const networkErrorMessages = [
    'network',
    'ECONNRESET',
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'fetch failed',
    'socket hang up',
  ];

  const message = error.message.toLowerCase();
  return networkErrorMessages.some(
    (msg) => message.includes(msg.toLowerCase())
  );
}

/**
 * Sleeps for the specified duration
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a function with retry logic
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Required<RetryConfig>,
  onRetry?: (error: Error, attempt: number, delay: number) => void | Promise<void>
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!shouldRetry(lastError, attempt, config)) {
        throw lastError;
      }

      const delay = calculateBackoffDelay(attempt, config);

      if (onRetry) {
        await onRetry(lastError, attempt, delay);
      }

      await sleep(delay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}
