/**
 * HTTP methods supported by the paginator
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Request configuration for API calls
 */
export interface RequestConfig {
  /** HTTP method for the request */
  method?: HttpMethod;
  /** Request headers */
  headers?: Record<string, string>;
  /** Request body (for POST/PUT/PATCH) */
  body?: unknown;
  /** Request timeout in milliseconds */
  timeout?: number;
}

/**
 * Response from an API call
 */
export interface ApiResponse<T> {
  /** Response data */
  data: T;
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
}

/**
 * Pagination state passed to hooks and extractors
 */
export interface PaginationState {
  /** Current page number (0-indexed) */
  page: number;
  /** Total items fetched so far */
  totalFetched: number;
  /** Whether this is the first page */
  isFirstPage: boolean;
  /** URL being fetched */
  url: string;
}

/**
 * Context passed to onBeforeFetch hook
 */
export interface BeforeFetchContext {
  /** URL to be fetched */
  url: string;
  /** Request configuration */
  config: RequestConfig;
  /** Current pagination state */
  pagination: PaginationState;
}

/**
 * Context passed to onAfterFetch hook
 */
export interface AfterFetchContext<T> {
  /** URL that was fetched */
  url: string;
  /** Response from the API */
  response: ApiResponse<T>;
  /** Current pagination state */
  pagination: PaginationState;
  /** Time taken for the request in milliseconds */
  duration: number;
}

/**
 * Context passed to onError hook
 */
export interface ErrorContext {
  /** Error that occurred */
  error: Error;
  /** URL that was being fetched */
  url: string;
  /** Current retry attempt (0-indexed) */
  attempt: number;
  /** Maximum retries configured */
  maxRetries: number;
  /** Whether a retry will be attempted */
  willRetry: boolean;
  /** Current pagination state */
  pagination: PaginationState;
}

/**
 * Context passed to onData hook
 */
export interface DataContext<TItem> {
  /** The data item */
  item: TItem;
  /** Index of this item in the current page */
  indexInPage: number;
  /** Global index across all pages */
  globalIndex: number;
  /** Current pagination state */
  pagination: PaginationState;
}

/**
 * Lifecycle hooks for the paginator
 */
export interface PaginatorHooks<TResponse, TItem> {
  /** Called before each fetch request */
  onBeforeFetch?: (context: BeforeFetchContext) => void | Promise<void>;
  /** Called after each successful fetch */
  onAfterFetch?: (context: AfterFetchContext<TResponse>) => void | Promise<void>;
  /** Called when an error occurs */
  onError?: (context: ErrorContext) => void | Promise<void>;
  /** Called for each data item yielded */
  onData?: (context: DataContext<TItem>) => void | Promise<void>;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelay?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelay?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Jitter factor (0-1) to add randomness to delays (default: 0.1) */
  jitter?: number;
  /** HTTP status codes that should trigger a retry (default: [408, 429, 500, 502, 503, 504]) */
  retryableStatusCodes?: number[];
  /** Custom function to determine if an error is retryable */
  isRetryable?: (error: Error, statusCode?: number) => boolean;
}

/**
 * Function to extract items from API response
 */
export type ItemExtractor<TResponse, TItem> = (response: TResponse) => TItem[];

/**
 * Function to get the next page URL from API response
 * Return null/undefined to indicate no more pages
 */
export type NextPageExtractor<TResponse> = (
  response: TResponse,
  pagination: PaginationState
) => string | null | undefined;

/**
 * SSRF protection configuration
 * Requires ssrf-agent-guard package to be installed
 */
export interface SsrfProtectionConfig {
  /** Enable SSRF protection (default: false) */
  enabled: boolean;
  /**
   * Custom ssrf-agent-guard options
   * @see https://www.npmjs.com/package/ssrf-agent-guard
   */
  options?: Record<string, unknown>;
}

/**
 * Main configuration for the lazy paginator
 */
export interface LazyPaginatorConfig<TResponse, TItem> {
  /** Initial URL to fetch */
  initialUrl: string;
  /** Request configuration */
  requestConfig?: RequestConfig;
  /** Function to extract items from response */
  extractItems: ItemExtractor<TResponse, TItem>;
  /** Function to get next page URL */
  getNextPageUrl: NextPageExtractor<TResponse>;
  /** Retry configuration */
  retry?: RetryConfig;
  /** Lifecycle hooks */
  hooks?: PaginatorHooks<TResponse, TItem>;
  /** Custom fetch function (defaults to global fetch) */
  fetchFn?: typeof fetch;
  /**
   * SSRF protection configuration for server-to-server calls
   * Requires ssrf-agent-guard package: npm install ssrf-agent-guard
   */
  ssrfProtection?: SsrfProtectionConfig;
}

/**
 * Error thrown when max retries are exceeded
 */
export class MaxRetriesExceededError extends Error {
  constructor(
    public readonly originalError: Error,
    public readonly attempts: number,
    public readonly url: string
  ) {
    super(`Max retries (${attempts}) exceeded for ${url}: ${originalError.message}`);
    this.name = 'MaxRetriesExceededError';
  }
}

/**
 * Error thrown when fetch times out
 */
export class FetchTimeoutError extends Error {
  constructor(
    public readonly url: string,
    public readonly timeout: number
  ) {
    super(`Fetch timeout after ${timeout}ms for ${url}`);
    this.name = 'FetchTimeoutError';
  }
}

/**
 * Error thrown for HTTP errors
 */
export class HttpError extends Error {
  constructor(
    public readonly url: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly responseBody?: string
  ) {
    super(`HTTP ${status} ${statusText} for ${url}`);
    this.name = 'HttpError';
  }
}
