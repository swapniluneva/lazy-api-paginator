# lazy-api-paginator

[![npm version](https://img.shields.io/npm/v/lazy-api-paginator.svg)](https://www.npmjs.com/package/lazy-api-paginator)
[![npm downloads](https://img.shields.io/npm/dm/lazy-api-paginator.svg)](https://www.npmjs.com/package/lazy-api-paginator)
[![CI](https://github.com/swapniluneva/lazy-api-paginator/actions/workflows/ci.yml/badge.svg)](https://github.com/swapniluneva/lazy-api-paginator/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/swapniluneva/lazy-api-paginator/graph/badge.svg?token=A2D0ER8MCN)](https://codecov.io/gh/swapniluneva/lazy-api-paginator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

A TypeScript module for lazily fetching paginated API data using async generators. Features include exponential backoff retry logic and lifecycle hooks.

## Features

- Lazy loading of paginated API data using async generators
- Iterate over items one-by-one without loading all pages into memory
- Exponential backoff retry with configurable jitter
- Lifecycle hooks: `onBeforeFetch`, `onAfterFetch`, `onError`, `onData`
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

## API Reference

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
| `hooks` | `PaginatorHooks` | No | Lifecycle hooks |
| `fetchFn` | `typeof fetch` | No | Custom fetch function |

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
