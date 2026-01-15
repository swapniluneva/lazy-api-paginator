// Main exports
export { LazyPaginator, createPaginator } from './paginator.js';

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
} from './types.js';

// Error exports
export {
  MaxRetriesExceededError,
  FetchTimeoutError,
  HttpError,
} from './types.js';

// Retry utilities (for advanced usage)
export {
  calculateBackoffDelay,
  shouldRetry,
  mergeRetryConfig,
  withRetry,
  sleep,
  DEFAULT_RETRY_CONFIG,
} from './retry.js';

// Built-in pagination strategies
export { strategies } from './strategies.js';
export type {
  StrategyResult,
  CursorStrategyConfig,
  OffsetStrategyConfig,
  PageNumberStrategyConfig,
  LinkHeaderStrategyConfig,
  KeysetStrategyConfig,
} from './strategies.js';

// SSRF protection utilities
export { createSecureFetch, validateUrl } from './ssrf.js';
