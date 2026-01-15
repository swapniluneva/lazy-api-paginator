# API Reference

Complete API documentation for `lazy-api-paginator`.

## Table of Contents

- [Factory Functions](#factory-functions)
- [Classes](#classes)
- [Configuration Types](#configuration-types)
- [Hook Types](#hook-types)
- [Error Classes](#error-classes)
- [Retry Utilities](#retry-utilities)
- [Type Definitions](#type-definitions)

---

## Factory Functions

### `createPaginator<TResponse, TItem>(config)`

Creates a new `LazyPaginator` instance. This is the recommended way to instantiate a paginator.

**Type Parameters:**
- `TResponse` - The shape of the API response
- `TItem` - The shape of individual items extracted from the response

**Parameters:**
- `config: LazyPaginatorConfig<TResponse, TItem>` - Configuration object

**Returns:** `LazyPaginator<TResponse, TItem>`

**Example:**
```typescript
import { createPaginator } from 'lazy-api-paginator';

interface ApiResponse {
  users: User[];
  nextCursor: string | null;
}

interface User {
  id: number;
  name: string;
}

const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.users,
  getNextPageUrl: (response) =>
    response.nextCursor
      ? `https://api.example.com/users?cursor=${response.nextCursor}`
      : null,
});
```

---

## Classes

### `LazyPaginator<TResponse, TItem>`

The core class that implements lazy pagination using async generators. Items are fetched on-demand as you iterate, making it memory-efficient for large datasets.

#### Constructor

```typescript
new LazyPaginator(config: LazyPaginatorConfig<TResponse, TItem>)
```

#### Methods

##### `[Symbol.asyncIterator]()`

Makes the paginator iterable with `for await...of` loops.

**Returns:** `AsyncGenerator<TItem>`

**Example:**
```typescript
for await (const item of paginator) {
  console.log(item);
}
```

##### `iterate()`

Returns an async generator that yields items one by one. Called internally by the async iterator.

**Returns:** `AsyncGenerator<TItem>`

**Example:**
```typescript
const generator = paginator.iterate();
const first = await generator.next();
console.log(first.value);
```

##### `take(n: number)`

Fetches and returns the first `n` items. Useful when you only need a subset of results.

**Parameters:**
- `n: number` - Maximum number of items to return

**Returns:** `Promise<TItem[]>`

**Example:**
```typescript
const firstTen = await paginator.take(10);
```

##### `toArray()`

Collects all items into an array. Use with caution for large datasets as this loads everything into memory.

**Returns:** `Promise<TItem[]>`

**Example:**
```typescript
const allItems = await paginator.toArray();
```

---

## Configuration Types

### `LazyPaginatorConfig<TResponse, TItem>`

Main configuration object for creating a paginator.

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `initialUrl` | `string` | Yes | The URL of the first page to fetch |
| `extractItems` | `ItemExtractor<TResponse, TItem>` | Yes | Function to extract items array from response |
| `getNextPageUrl` | `NextPageExtractor<TResponse>` | Yes | Function to get next page URL; return `null` or `undefined` to stop pagination |
| `requestConfig` | `RequestConfig` | No | HTTP request configuration |
| `retry` | `RetryConfig` | No | Retry strategy configuration |
| `hooks` | `PaginatorHooks<TResponse, TItem>` | No | Lifecycle callbacks |
| `fetchFn` | `typeof fetch` | No | Custom fetch function (defaults to global `fetch`) |

### `RequestConfig`

HTTP request configuration options.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `method` | `HttpMethod` | `'GET'` | HTTP method |
| `headers` | `Record<string, string>` | `{}` | Request headers |
| `body` | `unknown` | - | Request body (for POST/PUT/PATCH) |
| `timeout` | `number` | - | Request timeout in milliseconds |

**Example:**
```typescript
{
  requestConfig: {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer token123',
      'Content-Type': 'application/json',
    },
    body: { filter: 'active' },
    timeout: 10000,
  }
}
```

### `RetryConfig`

Configuration for the exponential backoff retry strategy.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `maxRetries` | `number` | `3` | Maximum number of retry attempts |
| `initialDelay` | `number` | `1000` | Initial delay in milliseconds |
| `maxDelay` | `number` | `30000` | Maximum delay cap in milliseconds |
| `backoffMultiplier` | `number` | `2` | Exponential backoff multiplier |
| `jitter` | `number` | `0.1` | Jitter factor (0-1) for randomness |
| `retryableStatusCodes` | `number[]` | `[408, 429, 500, 502, 503, 504]` | HTTP status codes that trigger retry |
| `isRetryable` | `(error: Error, statusCode?: number) => boolean` | - | Custom function to determine if error is retryable |

**Backoff Formula:**
```
delay = min(initialDelay * (backoffMultiplier ^ attempt), maxDelay)
actualDelay = delay * (1 + random(-jitter, jitter))
```

**Example:**
```typescript
{
  retry: {
    maxRetries: 5,
    initialDelay: 500,
    maxDelay: 60000,
    backoffMultiplier: 2,
    jitter: 0.2,
    retryableStatusCodes: [429, 503],
    isRetryable: (error, statusCode) => {
      // Custom logic: retry on specific error messages
      return error.message.includes('ECONNRESET');
    },
  }
}
```

---

## Hook Types

### `PaginatorHooks<TResponse, TItem>`

Lifecycle hooks for monitoring and controlling pagination flow.

| Hook | Type | Description |
|------|------|-------------|
| `onBeforeFetch` | `(context: BeforeFetchContext) => void \| Promise<void>` | Called before each page fetch |
| `onAfterFetch` | `(context: AfterFetchContext<TResponse>) => void \| Promise<void>` | Called after successful fetch |
| `onError` | `(context: ErrorContext) => void \| Promise<void>` | Called when an error occurs |
| `onData` | `(context: DataContext<TItem>) => void \| Promise<void>` | Called for each item yielded |

### `BeforeFetchContext`

Context passed to the `onBeforeFetch` hook.

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | URL about to be fetched |
| `config` | `RequestConfig` | Request configuration |
| `pagination` | `PaginationState` | Current pagination state |

### `AfterFetchContext<TResponse>`

Context passed to the `onAfterFetch` hook.

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | URL that was fetched |
| `response` | `ApiResponse<TResponse>` | API response with data and metadata |
| `pagination` | `PaginationState` | Current pagination state |
| `duration` | `number` | Time taken for the request in milliseconds |

### `ErrorContext`

Context passed to the `onError` hook.

| Property | Type | Description |
|----------|------|-------------|
| `error` | `Error` | The error that occurred |
| `url` | `string` | URL being fetched when error occurred |
| `attempt` | `number` | Current retry attempt (0-indexed) |
| `maxRetries` | `number` | Maximum retries configured |
| `willRetry` | `boolean` | Whether another retry will be attempted |
| `pagination` | `PaginationState` | Current pagination state |

### `DataContext<TItem>`

Context passed to the `onData` hook.

| Property | Type | Description |
|----------|------|-------------|
| `item` | `TItem` | The data item being yielded |
| `indexInPage` | `number` | Item's index within the current page (0-indexed) |
| `globalIndex` | `number` | Item's index across all pages (0-indexed) |
| `pagination` | `PaginationState` | Current pagination state |

### `PaginationState`

State information about the current pagination progress.

| Property | Type | Description |
|----------|------|-------------|
| `page` | `number` | Current page number (0-indexed) |
| `totalFetched` | `number` | Total items fetched so far |
| `isFirstPage` | `boolean` | Whether this is the first page |
| `url` | `string` | URL being fetched |

### `ApiResponse<T>`

Wrapper for API response data.

| Property | Type | Description |
|----------|------|-------------|
| `data` | `T` | Response payload |
| `status` | `number` | HTTP status code |
| `headers` | `Record<string, string>` | Response headers |

**Example with all hooks:**
```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  hooks: {
    onBeforeFetch: async ({ url, pagination }) => {
      console.log(`[Page ${pagination.page}] Fetching: ${url}`);
    },
    onAfterFetch: async ({ response, duration, pagination }) => {
      console.log(`[Page ${pagination.page}] Fetched in ${duration}ms`);
      console.log(`Status: ${response.status}`);
    },
    onError: async ({ error, attempt, maxRetries, willRetry }) => {
      console.error(`Attempt ${attempt + 1}/${maxRetries + 1}: ${error.message}`);
      if (!willRetry) {
        console.error('No more retries, giving up');
      }
    },
    onData: async ({ item, globalIndex }) => {
      console.log(`Processing item ${globalIndex}: ${item.id}`);
    },
  },
});
```

---

## Error Classes

### `MaxRetriesExceededError`

Thrown when all retry attempts have been exhausted.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `originalError` | `Error` | The original error that triggered retries |
| `attempts` | `number` | Number of attempts made |
| `url` | `string` | The URL that failed |

**Example:**
```typescript
try {
  for await (const item of paginator) {
    // process items
  }
} catch (error) {
  if (error instanceof MaxRetriesExceededError) {
    console.error(`Failed after ${error.attempts} attempts: ${error.url}`);
    console.error(`Original error: ${error.originalError.message}`);
  }
}
```

### `FetchTimeoutError`

Thrown when a request exceeds the configured timeout.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | The URL that timed out |
| `timeout` | `number` | Timeout duration in milliseconds |

**Example:**
```typescript
try {
  for await (const item of paginator) {
    // process items
  }
} catch (error) {
  if (error instanceof FetchTimeoutError) {
    console.error(`Request to ${error.url} timed out after ${error.timeout}ms`);
  }
}
```

### `HttpError`

Thrown for non-2xx HTTP responses that are not retryable.

**Properties:**

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | The URL that returned an error |
| `status` | `number` | HTTP status code |
| `statusText` | `string` | HTTP status text |
| `responseBody` | `string \| undefined` | Response body (if available) |

**Example:**
```typescript
try {
  for await (const item of paginator) {
    // process items
  }
} catch (error) {
  if (error instanceof HttpError) {
    console.error(`HTTP ${error.status} ${error.statusText}`);
    console.error(`URL: ${error.url}`);
    if (error.responseBody) {
      console.error(`Body: ${error.responseBody}`);
    }
  }
}
```

---

## Retry Utilities

Advanced utilities for custom retry logic. These are exported for users who need fine-grained control.

### `DEFAULT_RETRY_CONFIG`

Readonly object containing default retry configuration values.

```typescript
const DEFAULT_RETRY_CONFIG: Readonly<Required<RetryConfig>> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 30000,
  backoffMultiplier: 2,
  jitter: 0.1,
  retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  isRetryable: (error, statusCode) => { /* default logic */ },
};
```

### `mergeRetryConfig(config?)`

Merges user-provided config with defaults.

**Parameters:**
- `config?: RetryConfig` - Partial retry configuration

**Returns:** `Required<RetryConfig>`

### `calculateBackoffDelay(attempt, config)`

Calculates the delay for a given retry attempt using exponential backoff with jitter.

**Parameters:**
- `attempt: number` - Current attempt number (0-indexed)
- `config: Required<RetryConfig>` - Retry configuration

**Returns:** `number` - Delay in milliseconds

### `shouldRetry(error, attempt, config)`

Determines if an error should trigger a retry.

**Parameters:**
- `error: Error` - The error that occurred
- `attempt: number` - Current attempt number
- `config: Required<RetryConfig>` - Retry configuration

**Returns:** `boolean`

### `withRetry<T>(fn, config, onRetry?)`

Wraps an async function with retry logic.

**Type Parameters:**
- `T` - Return type of the function

**Parameters:**
- `fn: () => Promise<T>` - Async function to retry
- `config: Required<RetryConfig>` - Retry configuration
- `onRetry?: (error: Error, attempt: number, delay: number) => void` - Optional callback on retry

**Returns:** `Promise<T>`

### `sleep(ms)`

Utility function to pause execution.

**Parameters:**
- `ms: number` - Milliseconds to sleep

**Returns:** `Promise<void>`

---

## Type Definitions

### `HttpMethod`

```typescript
type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

### `ItemExtractor<TResponse, TItem>`

Function type for extracting items from an API response.

```typescript
type ItemExtractor<TResponse, TItem> = (response: TResponse) => TItem[];
```

### `NextPageExtractor<TResponse>`

Function type for determining the next page URL.

```typescript
type NextPageExtractor<TResponse> = (
  response: TResponse,
  pagination: PaginationState
) => string | null | undefined;
```

Return `null` or `undefined` to stop pagination.

---

## Usage Patterns

### Cursor-based Pagination

```typescript
interface Response {
  items: Item[];
  cursor: string | null;
}

const paginator = createPaginator<Response, Item>({
  initialUrl: 'https://api.example.com/items',
  extractItems: (r) => r.items,
  getNextPageUrl: (r) => r.cursor ? `https://api.example.com/items?cursor=${r.cursor}` : null,
});
```

### Offset-based Pagination

```typescript
interface Response {
  items: Item[];
  total: number;
}

const PAGE_SIZE = 100;

const paginator = createPaginator<Response, Item>({
  initialUrl: 'https://api.example.com/items?offset=0&limit=100',
  extractItems: (r) => r.items,
  getNextPageUrl: (r, state) => {
    const nextOffset = (state.page + 1) * PAGE_SIZE;
    return nextOffset < r.total
      ? `https://api.example.com/items?offset=${nextOffset}&limit=${PAGE_SIZE}`
      : null;
  },
});
```

### Page Number Pagination

```typescript
interface Response {
  data: Item[];
  meta: {
    currentPage: number;
    lastPage: number;
  };
}

const paginator = createPaginator<Response, Item>({
  initialUrl: 'https://api.example.com/items?page=1',
  extractItems: (r) => r.data,
  getNextPageUrl: (r) => {
    const { currentPage, lastPage } = r.meta;
    return currentPage < lastPage
      ? `https://api.example.com/items?page=${currentPage + 1}`
      : null;
  },
});
```

### Link Header Pagination

```typescript
const paginator = createPaginator<Item[], Item>({
  initialUrl: 'https://api.example.com/items',
  extractItems: (items) => items,
  getNextPageUrl: (_, state) => {
    // Access response headers via hooks or custom logic
    return null; // Implement based on Link header parsing
  },
  hooks: {
    onAfterFetch: ({ response }) => {
      // Parse Link header: response.headers['link']
    },
  },
});
```

---

## Exports

All public APIs are exported from the main entry point:

```typescript
import {
  // Factory function
  createPaginator,

  // Class
  LazyPaginator,

  // Error classes
  MaxRetriesExceededError,
  FetchTimeoutError,
  HttpError,

  // Retry utilities
  DEFAULT_RETRY_CONFIG,
  mergeRetryConfig,
  calculateBackoffDelay,
  shouldRetry,
  withRetry,
  sleep,

  // Types (TypeScript only)
  type LazyPaginatorConfig,
  type RequestConfig,
  type RetryConfig,
  type PaginatorHooks,
  type BeforeFetchContext,
  type AfterFetchContext,
  type ErrorContext,
  type DataContext,
  type PaginationState,
  type ApiResponse,
  type HttpMethod,
  type ItemExtractor,
  type NextPageExtractor,
} from 'lazy-api-paginator';
```
