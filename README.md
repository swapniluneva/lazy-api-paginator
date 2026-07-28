# lazy-api-paginator

[![npm version](https://img.shields.io/npm/v/lazy-api-paginator.svg)](https://www.npmjs.com/package/lazy-api-paginator)
[![npm downloads](https://img.shields.io/npm/dm/lazy-api-paginator.svg)](https://www.npmjs.com/package/lazy-api-paginator)
[![codecov](https://codecov.io/gh/swapniluneva/lazy-api-paginator/graph/badge.svg?token=A2D0ER8MCN)](https://codecov.io/gh/swapniluneva/lazy-api-paginator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

The ultimate TypeScript engine for handling rate-limited, paginated API data stream using async generators..

## Why lazy-api-paginator?

| Traditional Pagination | Lazy API Paginator |
| :--- | :--- |
| Loads entire datasets into memory, risking crashes | Lazily yields items one-by-one via async generators |
| Manual, complex while-loops for token/cursor matching | Out-of-the-box strategies for Slack, GitHub, Stripe, and Laravel |
| Crashing on 429 Too Many Requests errors | Built-in request throttling and smart Retry-After header parsing |

## Features

- Lazy loading of paginated API data using async generators
- Iterate over items one-by-one without loading all pages into memory
- Built-in strategies for cursor, offset, page number, link header, and keyset pagination
- Exponential backoff retry with configurable jitter
- Rate limiting with request throttling and automatic 429 handling
- Lifecycle hooks: `onBeforeFetch`, `onAfterFetch`, `onError`, `onData`
- SSRF protection for secure server-to-server calls (via [ssrf-agent-guard](https://www.npmjs.com/package/ssrf-agent-guard))
- Full TypeScript support
- Works with both ESM and CommonJS

## Installation

```bash
npm install lazy-api-paginator
```

## Usage

### Basic Usage

```typescript
import { createPaginator } from 'lazy-api-paginator';

interface ApiResponse {
  data: User[];
  nextCursor: string | null;
}

interface User {
  id: number;
  name: string;
}

const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) =>
    response.nextCursor
      ? `https://api.example.com/users?cursor=${response.nextCursor}`
      : null,
});

// Iterate lazily - pages are fetched on-demand
for await (const user of paginator) {
  console.log(user.name);
}
```

### With Lifecycle Hooks

```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  hooks: {
    onBeforeFetch: ({ url, pagination }) => {
      console.log(`Fetching page ${pagination.page}: ${url}`);
    },
    onAfterFetch: ({ response, duration }) => {
      console.log(`Fetched ${response.data.data.length} items in ${duration}ms`);
    },
    onError: ({ error, attempt, willRetry }) => {
      console.error(`Error (attempt ${attempt}): ${error.message}`);
      if (willRetry) console.log('Retrying...');
    },
    onData: ({ item, globalIndex }) => {
      console.log(`Processing item ${globalIndex}: ${item.name}`);
    },
  },
});
```

### Custom Retry Configuration

```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  retry: {
    maxRetries: 5,
    initialDelay: 1000,      // 1 second
    maxDelay: 30000,         // 30 seconds
    backoffMultiplier: 2,    // Exponential factor
    jitter: 0.1,             // 10% randomness
    retryableStatusCodes: [408, 429, 500, 502, 503, 504],
    isRetryable: (error, statusCode) => {
      // Custom retry logic
      return statusCode === 418; // Retry teapot errors
    },
  },
});
```

### Request Configuration

```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  requestConfig: {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer token123',
      'Content-Type': 'application/json',
    },
    body: { filter: 'active' },
    timeout: 10000,
  },
});
```

### Helper Methods

```typescript
// Get first N items
const firstTen = await paginator.take(10);

// Get all items (use with caution for large datasets)
const allUsers = await paginator.toArray();
```

### Built-in Pagination Strategies

Use pre-built strategies to eliminate boilerplate for common API patterns:

```typescript
import { createPaginator, strategies } from 'lazy-api-paginator';

// Optimized for Stripe, Slack, and Notion Cursor Pagination
const cursorPaginator = createPaginator({
  initialUrl: 'https://api.slack.com/users.list',
  ...strategies.cursor({
    dataPath: 'members',
    cursorPath: 'response_metadata.next_cursor',
  }),
});

// Offset-based (traditional REST APIs)
const offsetPaginator = createPaginator({
  initialUrl: 'https://api.example.com/items?offset=0&limit=100',
  ...strategies.offset({
    dataPath: 'items',
    totalPath: 'total',
    pageSize: 100,
  }),
});

// Page number-based (Laravel, Django)
const pagePaginator = createPaginator({
  initialUrl: 'https://api.example.com/items?page=1',
  ...strategies.pageNumber({
    dataPath: 'results',
    totalPagesPath: 'total_pages',
  }),
});

// Link header (GitHub API)
const linkStrategy = strategies.linkHeader({ dataPath: '' });
const githubPaginator = createPaginator({
  initialUrl: 'https://api.github.com/repos/owner/repo/issues',
  ...linkStrategy,
  hooks: {
    onAfterFetch: ({ response }) => {
      const link = response.headers['link'];
      if (link) linkStrategy.setNextFromHeader(link);
    },
  },
});

// Keyset/Seek (efficient for large datasets)
const keysetPaginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  ...strategies.keyset({
    dataPath: 'data',
    keyPath: 'id',
    hasMorePath: 'has_more',
  }),
});
```

### Rate Limiting

Configure request throttling and automatic handling of 429 (Too Many Requests) responses:

```typescript
const paginator = createPaginator<ApiResponse, User>({
  initialUrl: 'https://api.example.com/users',
  extractItems: (response) => response.data,
  getNextPageUrl: (response) => response.nextCursor,
  rateLimit: {
    requestsPerSecond: 10,        // Throttle to 10 requests/sec
    respectRetryAfter: true,      // Honor Retry-After headers
    maxRateLimitDelay: 60000,     // Max wait time: 60 seconds
    onRateLimitHit: ({ url, delayMs }) => {
      console.log(`Rate limited on ${url}, waiting ${delayMs}ms`);
    },
  },
});
```

The paginator automatically:
- Throttles requests to stay within `requestsPerSecond`
- Parses `X-RateLimit-*`, `RateLimit-*`, and `Retry-After` headers
- Waits and retries when receiving 429 responses
- Preemptively waits when rate limit is about to be exhausted

### SSRF Protection

For server-to-server calls, enable SSRF (Server-Side Request Forgery) protection to block requests to internal networks, cloud metadata endpoints, and other potentially dangerous destinations.

First, install the optional dependency:

```bash
npm install ssrf-agent-guard
```

Then enable SSRF protection in your paginator:

```typescript
import { createPaginator } from 'lazy-api-paginator';

const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  extractItems: (r) => r.items,
  getNextPageUrl: (r) => r.next,
  ssrfProtection: {
    enabled: true,
    options: {
      // Optional: customize ssrf-agent-guard options
      mode: 'block', // 'block' | 'report' | 'allow'
    },
  },
});
```

You can also use the standalone `createSecureFetch` utility:

```typescript
import { createSecureFetch, createPaginator } from 'lazy-api-paginator';

const secureFetch = await createSecureFetch({ enabled: true });

const paginator = createPaginator({
  initialUrl: 'https://api.example.com/items',
  extractItems: (r) => r.items,
  getNextPageUrl: (r) => r.next,
  fetchFn: secureFetch,
});
```

## API Reference

For complete API documentation including all types, interfaces, error classes, and usage patterns, see [API.md](./API.md).

### `createPaginator<TResponse, TItem>(config)`

Creates a new lazy paginator instance.

#### Config Options

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `initialUrl` | `string` | Yes | The URL of the first page to fetch |
| `extractItems` | `(response: TResponse) => TItem[]` | Yes | Function to extract items from API response |
| `getNextPageUrl` | `(response: TResponse, pagination: PaginationState) => string \| null` | Yes | Function to get next page URL (return null to stop) |
| `requestConfig` | `RequestConfig` | No | HTTP request configuration |
| `retry` | `RetryConfig` | No | Retry configuration |
| `rateLimit` | `RateLimitConfig` | No | Rate limiting configuration |
| `hooks` | `PaginatorHooks` | No | Lifecycle hooks |
| `fetchFn` | `typeof fetch` | No | Custom fetch function |
| `ssrfProtection` | `SsrfProtectionConfig` | No | SSRF protection settings |

### Hooks

| Hook | Context | Description |
|------|---------|-------------|
| `onBeforeFetch` | `{ url, config, pagination }` | Called before each request |
| `onAfterFetch` | `{ url, response, pagination, duration }` | Called after successful request |
| `onError` | `{ error, url, attempt, maxRetries, willRetry, pagination }` | Called on error |
| `onData` | `{ item, indexInPage, globalIndex, pagination }` | Called for each item yielded |

### Error Types

- `MaxRetriesExceededError` - Thrown when max retries are exceeded
- `FetchTimeoutError` - Thrown when a request times out
- `HttpError` - Thrown for non-2xx HTTP responses

## License

MIT © [Swapnil Srivastava](https://swapniluneva.github.io)
