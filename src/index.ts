// Main exports
export { LazyPaginator, createPaginator } from './core/paginator.js';

// Type exports
export type {
  HttpMethod,
  RequestConfig,
  ApiResponse,
  PaginationState,
  BeforeFetchContext,
  AfterFetchContext,
  ErrorContext,
  DataContext,
  PaginatorHooks,
  RetryConfig,
  ItemExtractor,
  NextPageExtractor,
  LazyPaginatorConfig,
  SsrfProtectionConfig,
  RateLimitConfig,
  RateLimitInfo,
  RateLimitState,
  RateLimitHitContext,
} from './core/types.js';

// Error exports
export {
  MaxRetriesExceededError,
  FetchTimeoutError,
  HttpError,
} from './core/types.js';

// Retry utilities (for advanced usage)
export {
  calculateBackoffDelay,
  shouldRetry,
  mergeRetryConfig,
  withRetry,
  sleep,
  DEFAULT_RETRY_CONFIG,
} from './utils/retry.js';

// Built-in pagination strategies
export { strategies } from './strategies/index.js';
export type {
  StrategyResult,
  CursorStrategyConfig,
  OffsetStrategyConfig,
  PageNumberStrategyConfig,
  LinkHeaderStrategyConfig,
  KeysetStrategyConfig,
} from './strategies/index.js';

// SSRF protection utilities
export { createSecureFetch, validateUrl } from './security/ssrf.js';

// Rate limiting utilities (for advanced usage)
export {
  parseStandardRateLimitHeaders,
  calculateThrottleDelay,
  calculateRateLimitDelay,
  calculatePreemptiveDelay,
  shouldPreemptiveWait,
  mergeRateLimitConfig,
  createRateLimitState,
  DEFAULT_RATE_LIMIT_CONFIG,
} from './utils/rate-limit.js';
