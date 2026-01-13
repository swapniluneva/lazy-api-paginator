import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  LazyPaginator,
  createPaginator,
  LazyPaginatorConfig,
  MaxRetriesExceededError,
  HttpError,
  BeforeFetchContext,
  AfterFetchContext,
  ErrorContext,
  DataContext,
} from './index.js';

// Mock response type
interface MockApiResponse {
  items: { id: number; name: string }[];
  nextPage: string | null;
  total: number;
}

type MockItem = { id: number; name: string };

// Helper to create mock fetch
function createMockFetch(responses: Array<{ data: MockApiResponse; status?: number; ok?: boolean }>) {
  let callIndex = 0;
  return vi.fn(async () => {
    const response = responses[callIndex++];
    if (!response) {
      throw new Error('No more mock responses');
    }
    const ok = response.ok ?? true;
    const status = response.status ?? 200;
    return {
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => response.data,
      text: async () => JSON.stringify(response.data),
      headers: new Map([['content-type', 'application/json']]),
    } as unknown as Response;
  });
}

describe('LazyPaginator', () => {
  describe('Basic iteration', () => {
    it('should iterate over items from a single page', async () => {
      const mockData: MockApiResponse = {
        items: [
          { id: 1, name: 'Item 1' },
          { id: 2, name: 'Item 2' },
        ],
        nextPage: null,
        total: 2,
      };

      const mockFetch = createMockFetch([{ data: mockData }]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items: MockItem[] = [];
      for await (const item of paginator) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ id: 1, name: 'Item 1' });
      expect(items[1]).toEqual({ id: 2, name: 'Item 2' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should lazily fetch multiple pages', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: 'https://api.example.com/items?page=2',
            total: 3,
          },
        },
        {
          data: {
            items: [{ id: 2, name: 'Item 2' }],
            nextPage: 'https://api.example.com/items?page=3',
            total: 3,
          },
        },
        {
          data: {
            items: [{ id: 3, name: 'Item 3' }],
            nextPage: null,
            total: 3,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('should only fetch pages as needed (lazy loading)', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
            nextPage: 'https://api.example.com/items?page=2',
            total: 4,
          },
        },
        {
          data: {
            items: [{ id: 3, name: 'Item 3' }, { id: 4, name: 'Item 4' }],
            nextPage: null,
            total: 4,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      // Only take 2 items - should only fetch first page
      const items = await paginator.take(2);

      expect(items).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only first page fetched
    });
  });

  describe('take() method', () => {
    it('should return exactly n items when available', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }, { id: 3, name: 'Item 3' }],
            nextPage: null,
            total: 3,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items = await paginator.take(2);
      expect(items).toHaveLength(2);
      expect(items[0].id).toBe(1);
      expect(items[1].id).toBe(2);
    });

    it('should return all items when n exceeds total', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items = await paginator.take(100);
      expect(items).toHaveLength(1);
    });
  });

  describe('Hooks', () => {
    it('should call onBeforeFetch before each request', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: 'https://api.example.com/items?page=2',
            total: 2,
          },
        },
        {
          data: {
            items: [{ id: 2, name: 'Item 2' }],
            nextPage: null,
            total: 2,
          },
        },
      ]);

      const onBeforeFetch = vi.fn();

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        hooks: { onBeforeFetch },
      });

      await paginator.toArray();

      expect(onBeforeFetch).toHaveBeenCalledTimes(2);
      expect(onBeforeFetch.mock.calls[0][0]).toMatchObject({
        url: 'https://api.example.com/items',
        pagination: { page: 0, isFirstPage: true },
      });
      expect(onBeforeFetch.mock.calls[1][0]).toMatchObject({
        url: 'https://api.example.com/items?page=2',
        pagination: { page: 1, isFirstPage: false },
      });
    });

    it('should call onAfterFetch after each successful request', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          },
        },
      ]);

      const onAfterFetch = vi.fn();

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        hooks: { onAfterFetch },
      });

      await paginator.toArray();

      expect(onAfterFetch).toHaveBeenCalledTimes(1);
      expect(onAfterFetch.mock.calls[0][0]).toMatchObject({
        url: 'https://api.example.com/items',
        response: {
          status: 200,
          data: { items: [{ id: 1, name: 'Item 1' }], nextPage: null, total: 1 },
        },
      });
      expect(onAfterFetch.mock.calls[0][0].duration).toBeGreaterThanOrEqual(0);
    });

    it('should call onData for each item yielded', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
            nextPage: null,
            total: 2,
          },
        },
      ]);

      const onData = vi.fn();

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        hooks: { onData },
      });

      await paginator.toArray();

      expect(onData).toHaveBeenCalledTimes(2);
      expect(onData.mock.calls[0][0]).toMatchObject({
        item: { id: 1, name: 'Item 1' },
        indexInPage: 0,
        globalIndex: 0,
      });
      expect(onData.mock.calls[1][0]).toMatchObject({
        item: { id: 2, name: 'Item 2' },
        indexInPage: 1,
        globalIndex: 1,
      });
    });

    it('should call onError when request fails', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({}),
            text: async () => 'Server Error',
            headers: new Map(),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          }),
          text: async () => '{}',
          headers: new Map(),
        } as unknown as Response;
      });

      const onError = vi.fn();

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: { maxRetries: 3, initialDelay: 10 },
        hooks: { onError },
      });

      await paginator.toArray();

      expect(onError).toHaveBeenCalledTimes(2);
      expect(onError.mock.calls[0][0]).toMatchObject({
        attempt: 0,
        willRetry: true,
      });
      expect(onError.mock.calls[1][0]).toMatchObject({
        attempt: 1,
        willRetry: true,
      });
    });
  });

  describe('Retry logic', () => {
    it('should retry on 500 errors', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: async () => ({}),
            text: async () => 'Server Error',
            headers: new Map(),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          }),
          text: async () => '{}',
          headers: new Map(),
        } as unknown as Response;
      });

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: { maxRetries: 3, initialDelay: 10 },
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should throw MaxRetriesExceededError after max retries', async () => {
      const mockFetch = vi.fn(async () => {
        return {
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({}),
          text: async () => 'Server Error',
          headers: new Map(),
        } as unknown as Response;
      });

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: { maxRetries: 2, initialDelay: 10 },
      });

      await expect(paginator.toArray()).rejects.toThrow(MaxRetriesExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should not retry on 400 errors', async () => {
      const mockFetch = vi.fn(async () => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({}),
          text: async () => 'Bad Request',
          headers: new Map(),
        } as unknown as Response;
      });

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: { maxRetries: 3, initialDelay: 10 },
      });

      await expect(paginator.toArray()).rejects.toThrow(MaxRetriesExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No retry for 400
    });

    it('should retry on 429 (rate limit) errors', async () => {
      let callCount = 0;
      const mockFetch = vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            json: async () => ({}),
            text: async () => 'Rate limited',
            headers: new Map(),
          } as unknown as Response;
        }
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => ({
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          }),
          text: async () => '{}',
          headers: new Map(),
        } as unknown as Response;
      });

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: { maxRetries: 3, initialDelay: 10 },
      });

      const items = await paginator.toArray();
      expect(items).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should support custom isRetryable function', async () => {
      const mockFetch = vi.fn(async () => {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          json: async () => ({}),
          text: async () => 'Bad Request',
          headers: new Map(),
        } as unknown as Response;
      });

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        retry: {
          maxRetries: 2,
          initialDelay: 10,
          isRetryable: (error, statusCode) => statusCode === 400, // Retry 400s
        },
      });

      await expect(paginator.toArray()).rejects.toThrow(MaxRetriesExceededError);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Now retries 400s
    });
  });

  describe('Request configuration', () => {
    it('should support custom headers', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        requestConfig: {
          headers: {
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          },
        },
      });

      await paginator.toArray();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer token123',
            'X-Custom-Header': 'custom-value',
          }),
        })
      );
    });

    it('should support POST method with body', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }],
            nextPage: null,
            total: 1,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
        requestConfig: {
          method: 'POST',
          body: { filter: 'active' },
        },
      });

      await paginator.toArray();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/items',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ filter: 'active' }),
        })
      );
    });
  });

  describe('Empty responses', () => {
    it('should handle empty item arrays', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [],
            nextPage: null,
            total: 0,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items = await paginator.toArray();
      expect(items).toHaveLength(0);
    });
  });

  describe('AsyncIterator protocol', () => {
    it('should be usable with for-await-of', async () => {
      const mockFetch = createMockFetch([
        {
          data: {
            items: [{ id: 1, name: 'Item 1' }, { id: 2, name: 'Item 2' }],
            nextPage: null,
            total: 2,
          },
        },
      ]);

      const paginator = createPaginator<MockApiResponse, MockItem>({
        initialUrl: 'https://api.example.com/items',
        extractItems: (response) => response.items,
        getNextPageUrl: (response) => response.nextPage,
        fetchFn: mockFetch,
      });

      const items: MockItem[] = [];
      for await (const item of paginator) {
        items.push(item);
      }

      expect(items).toHaveLength(2);
    });
  });
});
