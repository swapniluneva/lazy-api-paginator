import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { AddressInfo } from 'net';
import { createPaginator } from '../core/paginator.js';
import { RateLimitHitContext } from '../core/types.js';

interface MockApiResponse {
  items: Array<{ id: number; name: string }>;
  nextPage: string | null;
}

describe('Rate limit integration tests with mock server', () => {
  let server: Server;
  let baseUrl: string;
  let requestCount: number;
  let requestTimestamps: number[];
  let rateLimitedCount: number; // Track how many 429s we've returned
  let serverConfig: {
    rateLimitAfter?: number;
    retryAfterSeconds?: number;
    rateLimitHeaders?: Record<string, string>;
    dynamicRateLimitHeaders?: () => Record<string, string>; // Dynamic headers function
    pageCount?: number;
    itemsPerPage?: number;
    delay?: number;
    rateLimitRecoveryAfter?: number; // How many 429s before recovery
  };

  const resetServerConfig = () => {
    requestCount = 0;
    requestTimestamps = [];
    rateLimitedCount = 0;
    serverConfig = {
      rateLimitAfter: undefined,
      retryAfterSeconds: 1,
      rateLimitHeaders: {},
      dynamicRateLimitHeaders: undefined,
      pageCount: 3,
      itemsPerPage: 2,
      delay: 0,
      rateLimitRecoveryAfter: 1, // By default, recover after 1 rate limited request
    };
  };

  const handleRequest = async (req: IncomingMessage, res: ServerResponse) => {
    requestCount++;
    requestTimestamps.push(Date.now());

    // Simulate delay if configured
    if (serverConfig.delay && serverConfig.delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, serverConfig.delay));
    }

    // Parse page from URL
    const url = new URL(req.url || '/', `http://localhost`);
    const page = parseInt(url.searchParams.get('page') || '1', 10);

    // Check if we should return 429
    // Rate limit activates after rateLimitAfter requests, but recovers after rateLimitRecoveryAfter 429s
    const isRateLimited =
      serverConfig.rateLimitAfter &&
      requestCount > serverConfig.rateLimitAfter &&
      rateLimitedCount < (serverConfig.rateLimitRecoveryAfter || 1);

    if (isRateLimited) {
      rateLimitedCount++;
      res.writeHead(429, {
        'Content-Type': 'application/json',
        'Retry-After': String(serverConfig.retryAfterSeconds || 1),
        ...serverConfig.rateLimitHeaders,
      });
      res.end(JSON.stringify({ error: 'Rate limited' }));
      return;
    }

    // Return paginated data
    const itemsPerPage = serverConfig.itemsPerPage || 2;
    const pageCount = serverConfig.pageCount || 3;
    const startId = (page - 1) * itemsPerPage + 1;

    const items = Array.from({ length: itemsPerPage }, (_, i) => ({
      id: startId + i,
      name: `Item ${startId + i}`,
    }));

    const hasNextPage = page < pageCount;
    const nextPage = hasNextPage ? `${baseUrl}?page=${page + 1}` : null;

    // Add rate limit headers (use dynamic function if provided)
    const rateLimitHeaders = serverConfig.dynamicRateLimitHeaders
      ? serverConfig.dynamicRateLimitHeaders()
      : serverConfig.rateLimitHeaders;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...rateLimitHeaders,
    };

    res.writeHead(200, headers);
    res.end(JSON.stringify({ items, nextPage }));
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        console.error('Server error:', err);
        res.writeHead(500);
        res.end('Internal Server Error');
      });
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as AddressInfo;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  });

  beforeEach(() => {
    resetServerConfig();
  });

  describe('Throttling (requestsPerSecond)', () => {
    it('should throttle requests when requestsPerSecond is set', async () => {
      serverConfig.pageCount = 3;
      serverConfig.itemsPerPage = 1;

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          requestsPerSecond: 5, // 200ms between requests
        },
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(3);
      expect(requestTimestamps.length).toBe(3);

      // Check that requests were spaced at least ~180ms apart (allowing some tolerance)
      for (let i = 1; i < requestTimestamps.length; i++) {
        const interval = requestTimestamps[i] - requestTimestamps[i - 1];
        expect(interval).toBeGreaterThanOrEqual(180);
      }
    });

    it('should throttle using minRequestInterval', async () => {
      serverConfig.pageCount = 3;
      serverConfig.itemsPerPage = 1;

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          minRequestInterval: 150, // 150ms between requests
        },
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(3);
      expect(requestTimestamps.length).toBe(3);

      // Check that requests were spaced at least ~140ms apart
      for (let i = 1; i < requestTimestamps.length; i++) {
        const interval = requestTimestamps[i] - requestTimestamps[i - 1];
        expect(interval).toBeGreaterThanOrEqual(140);
      }
    });

    it('should not throttle when requestsPerSecond is 0', async () => {
      serverConfig.pageCount = 3;
      serverConfig.itemsPerPage = 1;
      serverConfig.delay = 10; // Small delay to make timing measurable

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          requestsPerSecond: 0, // Disabled
        },
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(3);
      expect(requestTimestamps.length).toBe(3);

      // Without throttling, requests should be close together
      // (only limited by server delay)
      for (let i = 1; i < requestTimestamps.length; i++) {
        const interval = requestTimestamps[i] - requestTimestamps[i - 1];
        expect(interval).toBeLessThan(100);
      }
    });
  });

  describe('429 Rate Limit Response Handling', () => {
    it('should retry after receiving 429 with Retry-After header', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitAfter = 1; // Rate limit after first request
      serverConfig.retryAfterSeconds = 1;
      serverConfig.rateLimitRecoveryAfter = 1; // Recover after 1 rate limited response

      const onRateLimitHit = vi.fn();

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          onRateLimitHit,
          maxRateLimitDelay: 5000,
        },
        retry: {
          maxRetries: 3,
          initialDelay: 100,
        },
      });

      const startTime = Date.now();
      const items = await paginator.toArray();
      const duration = Date.now() - startTime;

      // Should have received items from both pages after recovery
      expect(items).toHaveLength(2);
      // Request count: page1 success + page2 rate-limited + page2 retry success
      expect(requestCount).toBe(3);
      // Should have waited at least 1 second due to Retry-After
      expect(duration).toBeGreaterThanOrEqual(900);
      // onRateLimitHit should have been called
      expect(onRateLimitHit).toHaveBeenCalled();
    }, 10000);

    it('should call onRateLimitHit with correct context', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitAfter = 1;
      serverConfig.retryAfterSeconds = 1;
      serverConfig.rateLimitRecoveryAfter = 1;

      const onRateLimitHit = vi.fn();

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          onRateLimitHit,
        },
        retry: {
          maxRetries: 2,
        },
      });

      await paginator.toArray();

      expect(onRateLimitHit).toHaveBeenCalled();
      const context: RateLimitHitContext = onRateLimitHit.mock.calls[0][0];
      expect(context.status).toBe(429);
      expect(context.delayMs).toBeGreaterThan(0);
      expect(context.url).toContain(baseUrl);
    }, 10000);

    it('should cap rate limit delay at maxRateLimitDelay', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitAfter = 1;
      serverConfig.retryAfterSeconds = 10; // Server asks for 10 seconds
      serverConfig.rateLimitRecoveryAfter = 1;

      const onRateLimitHit = vi.fn();

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          onRateLimitHit,
          maxRateLimitDelay: 500, // Cap at 500ms for faster test
        },
        retry: {
          maxRetries: 2,
        },
      });

      const startTime = Date.now();
      await paginator.toArray();
      const duration = Date.now() - startTime;

      expect(onRateLimitHit).toHaveBeenCalled();
      const context: RateLimitHitContext = onRateLimitHit.mock.calls[0][0];
      // Delay should be capped at 500ms
      expect(context.delayMs).toBe(500);
      // Duration should reflect the capped delay, not 10 seconds
      expect(duration).toBeLessThan(3000);
    }, 10000);
  });

  describe('Rate Limit Headers Parsing', () => {
    it('should parse X-RateLimit-* headers from response', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitHeaders = {
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '50',
        'X-RateLimit-Reset': String(Math.floor(Date.now() / 1000) + 60),
      };

      const afterFetchCalls: Array<{ remaining?: number; limit?: number }> = [];

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        hooks: {
          onAfterFetch: (ctx) => {
            afterFetchCalls.push({
              remaining: ctx.response.headers['x-ratelimit-remaining']
                ? parseInt(ctx.response.headers['x-ratelimit-remaining'], 10)
                : undefined,
              limit: ctx.response.headers['x-ratelimit-limit']
                ? parseInt(ctx.response.headers['x-ratelimit-limit'], 10)
                : undefined,
            });
          },
        },
      });

      await paginator.toArray();

      expect(afterFetchCalls.length).toBeGreaterThan(0);
      expect(afterFetchCalls[0].limit).toBe(100);
      expect(afterFetchCalls[0].remaining).toBe(50);
    });

    it('should use custom parseRateLimitHeaders function', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitHeaders = {
        'X-Custom-Limit': '200',
        'X-Custom-Remaining': '5',
      };

      let parsedRemaining: number | undefined;

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          parseRateLimitHeaders: (headers) => {
            const remaining = headers['x-custom-remaining']
              ? parseInt(headers['x-custom-remaining'], 10)
              : undefined;
            parsedRemaining = remaining;
            return {
              limit: headers['x-custom-limit']
                ? parseInt(headers['x-custom-limit'], 10)
                : undefined,
              remaining,
            };
          },
        },
      });

      await paginator.toArray();

      expect(parsedRemaining).toBe(5);
    });
  });

  describe('Preemptive Waiting', () => {
    it('should preemptively wait when remaining requests are low', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 1;

      const retryAfterSeconds = 2; // API says wait 2 seconds

      // Use Retry-After header which has simpler parsing (direct seconds value)
      serverConfig.dynamicRateLimitHeaders = () => ({
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '1', // Only 1 request remaining - triggers preemptive wait
        'Retry-After': String(retryAfterSeconds),
      });

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          maxRateLimitDelay: 10000,
        },
      });

      const startTime = Date.now();
      const items = await paginator.toArray();
      const duration = Date.now() - startTime;

      expect(items).toHaveLength(2);
      // API says remaining=1 and Retry-After=2 seconds
      // Paginator should preemptively wait at least 2 seconds before page 2
      expect(duration).toBeGreaterThanOrEqual(retryAfterSeconds * 1000);
    }, 10000);
  });

  describe('Combined Throttling and Rate Limiting', () => {
    it('should apply both throttling and rate limit handling', async () => {
      serverConfig.pageCount = 3;
      serverConfig.itemsPerPage = 1;
      serverConfig.rateLimitAfter = 2; // Rate limit after 2 requests
      serverConfig.retryAfterSeconds = 1;
      serverConfig.rateLimitRecoveryAfter = 1; // Recover after 1 rate limited response

      const onRateLimitHit = vi.fn();

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
        rateLimit: {
          requestsPerSecond: 10, // 100ms between requests
          onRateLimitHit,
        },
        retry: {
          maxRetries: 3,
        },
      });

      const items = await paginator.toArray();

      // All 3 pages should succeed after rate limit recovery
      expect(items).toHaveLength(3);

      // Check throttling was applied
      if (requestTimestamps.length >= 2) {
        const interval = requestTimestamps[1] - requestTimestamps[0];
        expect(interval).toBeGreaterThanOrEqual(90);
      }

      // Rate limit callback should have been called
      expect(onRateLimitHit).toHaveBeenCalled();
    }, 10000);
  });

  describe('No Rate Limiting Configuration', () => {
    it('should work without any rate limit config', async () => {
      serverConfig.pageCount = 2;
      serverConfig.itemsPerPage = 2;

      const paginator = createPaginator<MockApiResponse, { id: number; name: string }>({
        initialUrl: `${baseUrl}?page=1`,
        extractItems: (res) => res.items,
        getNextPageUrl: (res) => res.nextPage,
      });

      const items = await paginator.toArray();

      expect(items).toHaveLength(4);
      expect(requestCount).toBe(2);
    });
  });
});
