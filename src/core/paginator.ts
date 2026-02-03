import {
  LazyPaginatorConfig,
  RequestConfig,
  ApiResponse,
  PaginationState,
  BeforeFetchContext,
  AfterFetchContext,
  ErrorContext,
  DataContext,
  MaxRetriesExceededError,
  FetchTimeoutError,
  HttpError,
  RateLimitState,
  RateLimitHitContext,
} from './types.js';
import { mergeRetryConfig, calculateBackoffDelay, shouldRetry } from '../utils/retry.js';
import { createSecureFetch } from '../security/ssrf.js';
import {
  mergeRateLimitConfig,
  createRateLimitState,
  parseStandardRateLimitHeaders,
  calculateThrottleDelay,
  calculateRateLimitDelay,
  calculatePreemptiveDelay,
  shouldPreemptiveWait,
  sleep,
} from '../utils/rate-limit.js';

/**
 * Default request configuration
 */
const DEFAULT_REQUEST_CONFIG: RequestConfig = {
  method: 'GET',
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
  timeout: 30000,
};

/**
 * LazyPaginator - Lazily fetches paginated API data using async generators
 */
export class LazyPaginator<TResponse, TItem> {
  private readonly config: LazyPaginatorConfig<TResponse, TItem>;
  private readonly requestConfig: RequestConfig;
  private readonly retryConfig: ReturnType<typeof mergeRetryConfig>;
  private readonly rateLimitConfig: ReturnType<typeof mergeRateLimitConfig>;
  private readonly baseFetchFn: typeof fetch;
  private secureFetchFn: typeof fetch | null = null;
  private rateLimitState: RateLimitState;

  constructor(config: LazyPaginatorConfig<TResponse, TItem>) {
    this.config = config;
    this.requestConfig = { ...DEFAULT_REQUEST_CONFIG, ...config.requestConfig };
    this.retryConfig = mergeRetryConfig(config.retry);
    this.rateLimitConfig = mergeRateLimitConfig(config.rateLimit);
    this.baseFetchFn = config.fetchFn ?? fetch;
    this.rateLimitState = createRateLimitState();
  }

  /**
   * Gets the fetch function, initializing SSRF protection if configured
   */
  private async getFetchFn(): Promise<typeof fetch> {
    if (this.config.ssrfProtection?.enabled) {
      if (!this.secureFetchFn) {
        this.secureFetchFn = await createSecureFetch(
          this.config.ssrfProtection,
          this.baseFetchFn
        );
      }
      return this.secureFetchFn;
    }
    return this.baseFetchFn;
  }

  /**
   * Creates an async iterator that yields items one by one, lazily loading pages
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<TItem, void, undefined> {
    yield* this.iterate();
  }

  /**
   * Main iteration method - yields items one by one with lazy page loading
   */
  async *iterate(): AsyncGenerator<TItem, void, undefined> {
    let currentUrl: string | null | undefined = this.config.initialUrl;
    let pageNumber = 0;
    let globalIndex = 0;

    while (currentUrl) {
      const pagination: PaginationState = {
        page: pageNumber,
        totalFetched: globalIndex,
        isFirstPage: pageNumber === 0,
        url: currentUrl,
      };

      // Fetch the current page with retry logic
      const response = await this.fetchPageWithRetry(currentUrl, pagination);

      // Extract items from response
      const items = this.config.extractItems(response.data);

      // Yield each item one by one
      for (let indexInPage = 0; indexInPage < items.length; indexInPage++) {
        const item = items[indexInPage];

        // Call onData hook if provided
        if (this.config.hooks?.onData) {
          const dataContext: DataContext<TItem> = {
            item,
            indexInPage,
            globalIndex,
            pagination,
          };
          await this.config.hooks.onData(dataContext);
        }

        yield item;
        globalIndex++;
      }

      // Get next page URL
      currentUrl = this.config.getNextPageUrl(response.data, pagination);
      pageNumber++;
    }
  }

  /**
   * Fetches all items into an array (use with caution for large datasets)
   */
  async toArray(): Promise<TItem[]> {
    const items: TItem[] = [];
    for await (const item of this.iterate()) {
      items.push(item);
    }
    return items;
  }

  /**
   * Takes the first n items
   */
  async take(n: number): Promise<TItem[]> {
    const items: TItem[] = [];
    for await (const item of this.iterate()) {
      items.push(item);
      if (items.length >= n) break;
    }
    return items;
  }

  /**
   * Fetches a page with retry logic and hooks
   */
  private async fetchPageWithRetry(
    url: string,
    pagination: PaginationState
  ): Promise<ApiResponse<TResponse>> {
    let attempt = 0;
    let lastError: Error | undefined;

    while (attempt <= this.retryConfig.maxRetries) {
      try {
        return await this.fetchPage(url, pagination);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const willRetry = shouldRetry(lastError, attempt, this.retryConfig);

        // Call onError hook
        if (this.config.hooks?.onError) {
          const errorContext: ErrorContext = {
            error: lastError,
            url,
            attempt,
            maxRetries: this.retryConfig.maxRetries,
            willRetry,
            pagination,
          };
          await this.config.hooks.onError(errorContext);
        }

        if (!willRetry) {
          throw new MaxRetriesExceededError(lastError, attempt + 1, url);
        }

        const delay = calculateBackoffDelay(attempt, this.retryConfig);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt++;
      }
    }

    throw new MaxRetriesExceededError(lastError!, attempt, url);
  }

  /**
   * Performs a single page fetch with hooks and rate limiting
   */
  private async fetchPage(
    url: string,
    pagination: PaginationState
  ): Promise<ApiResponse<TResponse>> {
    // Apply throttle delay (respects requestsPerSecond / minRequestInterval)
    const throttleDelay = calculateThrottleDelay(this.rateLimitConfig, this.rateLimitState);
    if (throttleDelay > 0) {
      await sleep(throttleDelay);
    }

    // Apply preemptive delay if rate limit is about to be exhausted
    if (shouldPreemptiveWait(this.rateLimitState.currentLimitInfo)) {
      const preemptiveDelay = calculatePreemptiveDelay(
        this.rateLimitState.currentLimitInfo,
        this.rateLimitConfig.maxRateLimitDelay
      );
      if (preemptiveDelay > 0) {
        await sleep(preemptiveDelay);
      }
    }

    // Call onBeforeFetch hook
    if (this.config.hooks?.onBeforeFetch) {
      const beforeContext: BeforeFetchContext = {
        url,
        config: this.requestConfig,
        pagination,
      };
      await this.config.hooks.onBeforeFetch(beforeContext);
    }

    const startTime = Date.now();

    // Build fetch options
    const fetchOptions: RequestInit = {
      method: this.requestConfig.method,
      headers: this.requestConfig.headers,
    };

    if (this.requestConfig.body && ['POST', 'PUT', 'PATCH'].includes(this.requestConfig.method || 'GET')) {
      fetchOptions.body = JSON.stringify(this.requestConfig.body);
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, this.requestConfig.timeout || 30000);

    try {
      const fetchFn = await this.getFetchFn();
      const response = await fetchFn(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Update rate limit state with request time
      this.rateLimitState.lastRequestTime = Date.now();

      // Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

      // Parse rate limit headers
      const rateLimitInfo = this.rateLimitConfig.parseRateLimitHeaders
        ? this.rateLimitConfig.parseRateLimitHeaders(headers)
        : parseStandardRateLimitHeaders(headers);

      // Update rate limit state with current info
      this.rateLimitState.currentLimitInfo = rateLimitInfo;

      // Handle rate limited response (429)
      if (response.status === 429) {
        const rateLimitDelay = calculateRateLimitDelay(
          this.rateLimitConfig,
          rateLimitInfo,
          response.status
        );

        // Call onRateLimitHit callback if configured
        if (this.rateLimitConfig.onRateLimitHit) {
          const rateLimitContext: RateLimitHitContext = {
            url,
            status: response.status,
            rateLimitInfo: rateLimitInfo || {},
            delayMs: rateLimitDelay,
            pagination,
          };
          await this.rateLimitConfig.onRateLimitHit(rateLimitContext);
        }

        // Wait for the rate limit cooldown period
        if (rateLimitDelay > 0) {
          await sleep(rateLimitDelay);
        }

        // Throw HttpError so retry logic can handle it
        const responseBody = await response.text().catch(() => undefined);
        throw new HttpError(url, response.status, response.statusText, responseBody);
      }

      if (!response.ok) {
        const responseBody = await response.text().catch(() => undefined);
        throw new HttpError(url, response.status, response.statusText, responseBody);
      }

      const data = (await response.json()) as TResponse;
      const duration = Date.now() - startTime;

      const apiResponse: ApiResponse<TResponse> = {
        data,
        status: response.status,
        headers,
      };

      // Call onAfterFetch hook
      if (this.config.hooks?.onAfterFetch) {
        const afterContext: AfterFetchContext<TResponse> = {
          url,
          response: apiResponse,
          pagination,
          duration,
        };
        await this.config.hooks.onAfterFetch(afterContext);
      }

      return apiResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new FetchTimeoutError(url, this.requestConfig.timeout || 30000);
      }

      throw error;
    }
  }
}

/**
 * Factory function to create a LazyPaginator
 */
export function createPaginator<TResponse, TItem>(
  config: LazyPaginatorConfig<TResponse, TItem>
): LazyPaginator<TResponse, TItem> {
  return new LazyPaginator(config);
}
