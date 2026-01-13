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
