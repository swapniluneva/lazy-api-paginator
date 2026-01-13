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
} from './types.js';
import { mergeRetryConfig, calculateBackoffDelay, shouldRetry } from './retry.js';

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
  private readonly fetchFn: typeof fetch;

  constructor(config: LazyPaginatorConfig<TResponse, TItem>) {
    this.config = config;
    this.requestConfig = { ...DEFAULT_REQUEST_CONFIG, ...config.requestConfig };
    this.retryConfig = mergeRetryConfig(config.retry);
    this.fetchFn = config.fetchFn ?? fetch;
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
   * Performs a single page fetch with hooks
   */
  private async fetchPage(
    url: string,
    pagination: PaginationState
  ): Promise<ApiResponse<TResponse>> {
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
      const response = await this.fetchFn(url, {
        ...fetchOptions,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const responseBody = await response.text().catch(() => undefined);
        throw new HttpError(url, response.status, response.statusText, responseBody);
      }

      const data = (await response.json()) as TResponse;
      const duration = Date.now() - startTime;

      // Convert headers to plain object
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });

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
