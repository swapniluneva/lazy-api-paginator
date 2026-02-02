# API Reference

Complete API documentation for `lazy-api-paginator`.

## Table of Contents

- [Factory Functions](#factory-functions)
- [Classes](#classes)
- [Configuration Types](#configuration-types)
- [Hook Types](#hook-types)
- [Error Classes](#error-classes)
- [Retry Utilities](#retry-utilities)
- [Rate Limiting](#rate-limiting)
- [Built-in Pagination Strategies](#built-in-pagination-strategies)
- [SSRF Protection](#ssrf-protection)
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
| `rateLimit` | `RateLimitConfig` | No | Rate limiting configuration |
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

## Rate Limiting

Configure request throttling and automatic handling of API rate limits. The paginator can throttle outgoing requests, parse rate limit headers, and automatically handle 429 (Too Many Requests) responses.

### `RateLimitConfig`

Configuration for rate limiting behavior.

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `requestsPerSecond` | `number` | `0` | Maximum requests per second (0 = disabled) |
| `minRequestInterval` | `number` | `0` | Minimum milliseconds between requests (overrides `requestsPerSecond` if set) |
| `respectRetryAfter` | `boolean` | `true` | Whether to respect `Retry-After` headers from 429 responses |
| `maxRateLimitDelay` | `number` | `60000` | Maximum delay when rate limited (in milliseconds) |
| `parseRateLimitHeaders` | `(headers: Record<string, string>) => RateLimitInfo \| null` | - | Custom function to extract rate limit info from headers |
| `onRateLimitHit` | `(context: RateLimitHitContext) => void \| Promise<void>` | - | Callback when rate limit is detected |

**Example:**
```typescript
{
  rateLimit: {
    requestsPerSecond: 10,        // 10 requests per second max
    maxRateLimitDelay: 30000,     // Wait up to 30 seconds when rate limited
    respectRetryAfter: true,
    onRateLimitHit: ({ url, status, delayMs }) => {
      console.log(`Rate limited on ${url}, waiting ${delayMs}ms`);
    },
  }
}
```

### `RateLimitInfo`

Information extracted from rate limit response headers.

| Property | Type | Description |
|----------|------|-------------|
| `limit` | `number \| undefined` | Total requests allowed in the current window |
| `remaining` | `number \| undefined` | Remaining requests in the current window |
| `reset` | `number \| undefined` | Unix timestamp (seconds) when the rate limit resets |
| `retryAfter` | `number \| undefined` | Seconds until the rate limit resets |

### `RateLimitHitContext`

Context passed to the `onRateLimitHit` callback.

| Property | Type | Description |
|----------|------|-------------|
| `url` | `string` | URL that triggered the rate limit |
| `status` | `number` | HTTP status code (usually 429) |
| `rateLimitInfo` | `RateLimitInfo` | Parsed rate limit info from headers |
| `delayMs` | `number` | Delay that will be applied in milliseconds |
| `pagination` | `PaginationState` | Current pagination state |

### Supported Rate Limit Headers

The paginator automatically parses these common header formats:

- **GitHub/Twitter style:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Alternative format:** `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining`, `X-Rate-Limit-Reset`
- **IETF draft:** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`
- **RFC 7231:** `Retry-After` (seconds or HTTP-date)

### Rate Limit Utilities

#### `parseStandardRateLimitHeaders(headers)`

Parses standard rate limit headers from an API response.

**Parameters:**
- `headers: Record<string, string>` - Response headers

**Returns:** `RateLimitInfo | null`

**Example:**
```typescript
import { parseStandardRateLimitHeaders } from 'lazy-api-paginator';

const info = parseStandardRateLimitHeaders({
  'X-RateLimit-Limit': '100',
  'X-RateLimit-Remaining': '5',
  'X-RateLimit-Reset': '1700000000',
});
// { limit: 100, remaining: 5, reset: 1700000000, retryAfter: undefined }
```

#### `DEFAULT_RATE_LIMIT_CONFIG`

Readonly object containing default rate limit configuration values.

```typescript
const DEFAULT_RATE_LIMIT_CONFIG = {
  requestsPerSecond: 0,
  respectRetryAfter: true,
  maxRateLimitDelay: 60000,
  minRequestInterval: 0,
  parseRateLimitHeaders: undefined,
  onRateLimitHit: undefined,
};
```

### Rate Limiting Behavior

1. **Request Throttling:** When `requestsPerSecond` or `minRequestInterval` is set, the paginator waits between requests to stay within the limit.

2. **429 Response Handling:** When a 429 response is received:
   - The `onRateLimitHit` callback is called (if configured)
   - The paginator waits for the duration specified by `Retry-After` header (or calculates from `reset` timestamp)
   - The request is automatically retried

3. **Preemptive Waiting:** When the `remaining` header indicates the rate limit is about to be exhausted (≤1 requests remaining), the paginator proactively waits until the reset time.

4. **Delay Capping:** All delays are capped at `maxRateLimitDelay` to prevent excessively long waits.

**Example with all rate limit features:**
```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  rateLimit: {
    requestsPerSecond: 5,           // Max 5 requests per second
    maxRateLimitDelay: 120000,      // Wait up to 2 minutes
    respectRetryAfter: true,
    parseRateLimitHeaders: (headers) => {
      // Custom header parsing for non-standard APIs
      return {
        remaining: parseInt(headers['x-custom-remaining'] || '100', 10),
        reset: parseInt(headers['x-custom-reset'] || '0', 10),
      };
    },
    onRateLimitHit: async ({ url, delayMs, rateLimitInfo }) => {
      console.log(`Rate limit hit on ${url}`);
      console.log(`Remaining: ${rateLimitInfo.remaining}, waiting ${delayMs}ms`);
      // Could also send alerts, log to monitoring, etc.
    },
  },
  retry: {
    maxRetries: 5,
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
  },
});
```

---

## Built-in Pagination Strategies

Pre-built extractors for common API pagination patterns. These eliminate boilerplate by providing ready-to-use `extractItems` and `getNextPageUrl` functions.

```typescript
import { createPaginator, strategies } from 'lazy-api-paginator';
```

### `strategies.cursor(config)`

Creates extractors for cursor-based pagination (Slack, Stripe, Notion style).

**Config:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataPath` | `string` | Yes | - | Path to data array (e.g., `'data'`, `'data.items'`) |
| `cursorPath` | `string` | Yes | - | Path to cursor value (e.g., `'next_cursor'`, `'meta.cursor'`) |
| `cursorParam` | `string` | No | `'cursor'` | Query parameter name for cursor |

**Example:**
```typescript
// API returns: { data: [...], next_cursor: "abc123" }
const paginator = createPaginator({
  initialUrl: 'https://api.slack.com/users.list',
  ...strategies.cursor({
    dataPath: 'data',
    cursorPath: 'next_cursor',
  }),
});
```

### `strategies.offset(config)`

Creates extractors for offset-based pagination (traditional REST APIs).

**Config:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataPath` | `string` | Yes | - | Path to data array |
| `totalPath` | `string` | Yes | - | Path to total count |
| `pageSize` | `number` | Yes | - | Items per page |
| `offsetParam` | `string` | No | `'offset'` | Query parameter for offset |
| `limitParam` | `string` | No | `'limit'` | Query parameter for limit |

**Example:**
```typescript
// API returns: { items: [...], total: 500 }
const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items?offset=0&limit=100',
  ...strategies.offset({
    dataPath: 'items',
    totalPath: 'total',
    pageSize: 100,
  }),
});
```

### `strategies.pageNumber(config)`

Creates extractors for page number-based pagination (Laravel, Django style).

**Config:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataPath` | `string` | Yes | - | Path to data array |
| `totalPagesPath` | `string` | No | - | Path to total pages count |
| `currentPagePath` | `string` | No | - | Path to current page number |
| `hasNextPath` | `string` | No | - | Path to boolean indicating more pages |
| `pageParam` | `string` | No | `'page'` | Query parameter for page number |
| `oneIndexed` | `boolean` | No | `true` | Whether pages start at 1 |

**Example:**
```typescript
// API returns: { results: [...], total_pages: 10 }
const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items?page=1',
  ...strategies.pageNumber({
    dataPath: 'results',
    totalPagesPath: 'total_pages',
  }),
});

// Or with has_more flag:
// API returns: { data: [...], has_more: true }
const paginator2 = createPaginator({
  initialUrl: 'https://api.example.com/items?page=1',
  ...strategies.pageNumber({
    dataPath: 'data',
    hasNextPath: 'has_more',
  }),
});
```

### `strategies.linkHeader(config)`

Creates extractors for Link header-based pagination (GitHub API style).

**Config:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataPath` | `string` | No | `''` | Path to data array (empty for root array) |
| `rel` | `string` | No | `'next'` | Link relation to look for |

**Returns:** `StrategyResult` with additional methods:
- `setNextFromHeader(header: string)` - Parse and set next URL from Link header
- `setNextUrl(url: string | null)` - Directly set the next URL

**Example:**
```typescript
// GitHub API returns array with Link header
const linkStrategy = strategies.linkHeader({ dataPath: '' });

const paginator = createPaginator({
  initialUrl: 'https://api.github.com/repos/owner/repo/issues',
  ...linkStrategy,
  hooks: {
    onAfterFetch: ({ response }) => {
      const linkHeader = response.headers['link'];
      if (linkHeader) {
        linkStrategy.setNextFromHeader(linkHeader);
      }
    },
  },
});
```

### `strategies.keyset(config)`

Creates extractors for keyset/seek pagination (efficient for large datasets).

**Config:**

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `dataPath` | `string` | Yes | - | Path to data array |
| `keyPath` | `string` | Yes | - | Path to key field in each item (e.g., `'id'`) |
| `afterParam` | `string` | No | `'after'` | Query parameter for "after" key |
| `hasMorePath` | `string` | No | - | Path to boolean indicating more items |
| `minPageSize` | `number` | No | - | Stop if fewer items returned |

**Example:**
```typescript
// API returns: { data: [{ id: 1 }, { id: 2 }], has_more: true }
const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  ...strategies.keyset({
    dataPath: 'data',
    keyPath: 'id',
    hasMorePath: 'has_more',
  }),
});
```

### Utility Functions

#### `strategies.parseLinkHeader(header)`

Parses a Link header string into a map of rel → URL.

```typescript
const links = strategies.parseLinkHeader(
  '<https://api.example.com?page=2>; rel="next", <https://api.example.com?page=10>; rel="last"'
);
// { next: 'https://api.example.com?page=2', last: 'https://api.example.com?page=10' }
```

#### `strategies.getByPath(obj, path)`

Gets a nested value from an object using dot notation.

```typescript
const value = strategies.getByPath({ data: { items: [1, 2] } }, 'data.items');
// [1, 2]
```

### Strategy Type Definitions

```typescript
interface StrategyResult<TResponse, TItem> {
  extractItems: ItemExtractor<TResponse, TItem>;
  getNextPageUrl: NextPageExtractor<TResponse>;
}

interface CursorStrategyConfig {
  dataPath: string;
  cursorPath: string;
  cursorParam?: string;
}

interface OffsetStrategyConfig {
  dataPath: string;
  totalPath: string;
  pageSize: number;
  offsetParam?: string;
  limitParam?: string;
}

interface PageNumberStrategyConfig {
  dataPath: string;
  totalPagesPath?: string;
  currentPagePath?: string;
  hasNextPath?: string;
  pageParam?: string;
  oneIndexed?: boolean;
}

interface LinkHeaderStrategyConfig {
  dataPath?: string;
  rel?: string;
}

interface KeysetStrategyConfig {
  dataPath: string;
  keyPath: string;
  afterParam?: string;
  hasMorePath?: string;
  minPageSize?: number;
}
```

---

## SSRF Protection

Utilities for protecting against Server-Side Request Forgery (SSRF) attacks when making server-to-server API calls.

**Requirements:** Install the optional peer dependency:
```bash
npm install ssrf-agent-guard
```

### `SsrfProtectionConfig`

Configuration for SSRF protection.

| Property | Type | Required | Default | Description |
|----------|------|----------|---------|-------------|
| `enabled` | `boolean` | Yes | - | Enable SSRF protection |
| `options` | `Record<string, unknown>` | No | `{}` | Custom ssrf-agent-guard options |

**Example:**
```typescript
const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  extractItems: (r) => r.items,
  getNextPageUrl: (r) => r.next,
  ssrfProtection: {
    enabled: true,
    options: {
      mode: 'block',
    },
  },
});
```

### `createSecureFetch(config, baseFetch?)`

Creates a fetch function with SSRF protection enabled.

**Parameters:**
- `config: SsrfProtectionConfig` - SSRF protection configuration
- `baseFetch?: typeof fetch` - Base fetch function to wrap (defaults to global `fetch`)

**Returns:** `Promise<typeof fetch>`

**Example:**
```typescript
import { createSecureFetch } from 'lazy-api-paginator';

const secureFetch = await createSecureFetch({ enabled: true });

// Use with paginator
const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  extractItems: (r) => r.items,
  getNextPageUrl: (r) => r.next,
  fetchFn: secureFetch,
});

// Or use directly
const response = await secureFetch('https://api.example.com/data');
```

### `validateUrl(url, options?)`

Validates a URL by creating an SSRF-protected agent. Useful for pre-validating URLs before making requests.

**Parameters:**
- `url: string` - The URL to validate
- `options?: Record<string, unknown>` - Optional ssrf-agent-guard options

**Returns:** `Promise<boolean>` - Returns `true` if agent creation succeeds

**Note:** The actual SSRF blocking happens at request time when the agent is used, not during agent creation.

**Example:**
```typescript
import { validateUrl } from 'lazy-api-paginator';

const isValid = await validateUrl('https://api.example.com/data');
console.log(isValid); // true
```

### What SSRF Protection Blocks

When enabled, ssrf-agent-guard blocks requests to:

- **Private IP addresses:** `192.168.x.x`, `10.x.x.x`, `172.16.x.x - 172.31.x.x`
- **Loopback addresses:** `127.0.0.1`, `localhost`
- **Cloud metadata endpoints:**
  - AWS: `169.254.169.254`
  - GCP: `metadata.google.internal`
  - Azure: `169.254.169.254`
  - And more...
- **Internal hostnames and DNS rebinding attacks**

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

  // Rate limit utilities
  DEFAULT_RATE_LIMIT_CONFIG,
  mergeRateLimitConfig,
  parseStandardRateLimitHeaders,

  // Built-in pagination strategies
  strategies,

  // SSRF protection utilities
  createSecureFetch,
  validateUrl,

  // Types (TypeScript only)
  type LazyPaginatorConfig,
  type SsrfProtectionConfig,
  type RequestConfig,
  type RetryConfig,
  type RateLimitConfig,
  type RateLimitInfo,
  type RateLimitHitContext,
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
  type StrategyResult,
  type CursorStrategyConfig,
  type OffsetStrategyConfig,
  type PageNumberStrategyConfig,
  type LinkHeaderStrategyConfig,
  type KeysetStrategyConfig,
} from 'lazy-api-paginator';
```
