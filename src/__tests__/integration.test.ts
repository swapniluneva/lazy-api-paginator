/**
 * Integration Tests for lazy-api-paginator
 *
 * These tests use a real HTTP server to verify end-to-end pagination behavior.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createMockServer, MockPaginationServer, MockRecord } from '../test-utils/mock-server.js';
import { createPaginator, strategies } from '../index.js';

describe('Integration Tests', () => {
  let baseUrl: string;
  let server: MockPaginationServer;
  let stopServer: () => Promise<void>;

  beforeAll(async () => {
    const mock = await createMockServer({
      totalRecords: 50,
      pageSize: 10,
    });
    baseUrl = mock.baseUrl;
    server = mock.server;
    stopServer = mock.stop;
  });

  afterAll(async () => {
    await stopServer();
  });

  describe('Basic Pagination', () => {
    it('should fetch all records from simple pagination endpoint', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        page: number;
        totalPages: number;
        nextPage: number | null;
      }

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
      expect(allRecords[0].id).toBe(1);
      expect(allRecords[49].id).toBe(50);
    });

    it('should lazily fetch records using take()', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
      });

      // Only take 15 records (should fetch 2 pages)
      const records = await paginator.take(15);

      expect(records).toHaveLength(15);
      expect(records[0].id).toBe(1);
      expect(records[14].id).toBe(15);
    });

    it('should iterate one record at a time', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
      });

      const ids: number[] = [];
      for await (const record of paginator) {
        ids.push(record.id);
        if (ids.length >= 5) break;
      }

      expect(ids).toEqual([1, 2, 3, 4, 5]);
    });
  });

  describe('Cursor-based Pagination Strategy', () => {
    it('should paginate using cursor strategy', async () => {
      interface CursorResponse {
        data: MockRecord[];
        next_cursor: string | null;
        has_more: boolean;
        total: number;
      }

      const cursorStrategy = strategies.cursor<CursorResponse, MockRecord>({
        dataPath: 'data',
        cursorPath: 'next_cursor',
      });

      const paginator = createPaginator<CursorResponse, MockRecord>({
        initialUrl: `${baseUrl}/cursor`,
        ...cursorStrategy,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
      expect(allRecords[0].id).toBe(1);
      expect(allRecords[49].id).toBe(50);
    });

    it('should correctly handle cursor continuation', async () => {
      interface CursorResponse {
        data: MockRecord[];
        next_cursor: string | null;
      }

      const cursorStrategy = strategies.cursor<CursorResponse, MockRecord>({
        dataPath: 'data',
        cursorPath: 'next_cursor',
      });

      const paginator = createPaginator<CursorResponse, MockRecord>({
        initialUrl: `${baseUrl}/cursor`,
        ...cursorStrategy,
      });

      // Take records spanning multiple pages
      const records = await paginator.take(25);

      expect(records).toHaveLength(25);
      // Verify records are in order
      for (let i = 0; i < 25; i++) {
        expect(records[i].id).toBe(i + 1);
      }
    });
  });

  describe('Offset-based Pagination Strategy', () => {
    it('should paginate using offset strategy', async () => {
      interface OffsetResponse {
        items: MockRecord[];
        total: number;
        offset: number;
        limit: number;
      }

      const offsetStrategy = strategies.offset<OffsetResponse, MockRecord>({
        dataPath: 'items',
        totalPath: 'total',
        pageSize: 10,
      });

      const paginator = createPaginator<OffsetResponse, MockRecord>({
        initialUrl: `${baseUrl}/offset?offset=0&limit=10`,
        ...offsetStrategy,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
      expect(allRecords[0].id).toBe(1);
      expect(allRecords[49].id).toBe(50);
    });

    it('should correctly calculate offsets across pages', async () => {
      interface OffsetResponse {
        items: MockRecord[];
        total: number;
      }

      const offsetStrategy = strategies.offset<OffsetResponse, MockRecord>({
        dataPath: 'items',
        totalPath: 'total',
        pageSize: 10,
      });

      const paginator = createPaginator<OffsetResponse, MockRecord>({
        initialUrl: `${baseUrl}/offset?offset=0&limit=10`,
        ...offsetStrategy,
      });

      const records = await paginator.take(35);

      expect(records).toHaveLength(35);
      expect(records[34].id).toBe(35);
    });
  });

  describe('Page Number Pagination Strategy', () => {
    it('should paginate using page number strategy', async () => {
      interface PageResponse {
        data: MockRecord[];
        meta: {
          current_page: number;
          total_pages: number;
          has_next: boolean;
        };
      }

      const pageStrategy = strategies.pageNumber<PageResponse, MockRecord>({
        dataPath: 'data',
        totalPagesPath: 'meta.total_pages',
        currentPagePath: 'meta.current_page',
      });

      const paginator = createPaginator<PageResponse, MockRecord>({
        initialUrl: `${baseUrl}/page?page=1`,
        ...pageStrategy,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
    });

    it('should work with has_next flag', async () => {
      interface PageResponse {
        data: MockRecord[];
        meta: {
          has_next: boolean;
        };
      }

      const pageStrategy = strategies.pageNumber<PageResponse, MockRecord>({
        dataPath: 'data',
        hasNextPath: 'meta.has_next',
      });

      const paginator = createPaginator<PageResponse, MockRecord>({
        initialUrl: `${baseUrl}/page?page=1`,
        ...pageStrategy,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
    });
  });

  describe('Link Header Pagination Strategy', () => {
    it('should paginate using link header strategy', async () => {
      const linkStrategy = strategies.linkHeader<MockRecord[], MockRecord>({
        dataPath: '',
      });

      const paginator = createPaginator<MockRecord[], MockRecord>({
        initialUrl: `${baseUrl}/link-header?page=1`,
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

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
      expect(allRecords[0].id).toBe(1);
      expect(allRecords[49].id).toBe(50);
    });
  });

  describe('Keyset Pagination Strategy', () => {
    it('should paginate using keyset strategy', async () => {
      interface KeysetResponse {
        data: MockRecord[];
        has_more: boolean;
      }

      const keysetStrategy = strategies.keyset<KeysetResponse, MockRecord>({
        dataPath: 'data',
        keyPath: 'id',
        hasMorePath: 'has_more',
      });

      const paginator = createPaginator<KeysetResponse, MockRecord>({
        initialUrl: `${baseUrl}/keyset`,
        ...keysetStrategy,
      });

      const allRecords = await paginator.toArray();

      expect(allRecords).toHaveLength(50);
      expect(allRecords[0].id).toBe(1);
      expect(allRecords[49].id).toBe(50);
    });

    it('should correctly use last item ID for next page', async () => {
      interface KeysetResponse {
        data: MockRecord[];
        has_more: boolean;
      }

      const keysetStrategy = strategies.keyset<KeysetResponse, MockRecord>({
        dataPath: 'data',
        keyPath: 'id',
        hasMorePath: 'has_more',
      });

      const paginator = createPaginator<KeysetResponse, MockRecord>({
        initialUrl: `${baseUrl}/keyset`,
        ...keysetStrategy,
      });

      const records = await paginator.take(25);

      expect(records).toHaveLength(25);
      // Verify sequential IDs
      for (let i = 0; i < 25; i++) {
        expect(records[i].id).toBe(i + 1);
      }
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should call all lifecycle hooks during pagination', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const hookCalls = {
        beforeFetch: 0,
        afterFetch: 0,
        onData: 0,
      };

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
        hooks: {
          onBeforeFetch: () => {
            hookCalls.beforeFetch++;
          },
          onAfterFetch: () => {
            hookCalls.afterFetch++;
          },
          onData: () => {
            hookCalls.onData++;
          },
        },
      });

      await paginator.toArray();

      // 50 records / 10 per page = 5 pages
      expect(hookCalls.beforeFetch).toBe(5);
      expect(hookCalls.afterFetch).toBe(5);
      expect(hookCalls.onData).toBe(50);
    });

    it('should provide correct pagination state in hooks', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const pageNumbers: number[] = [];
      const totalsFetched: number[] = [];

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
        hooks: {
          onBeforeFetch: ({ pagination }) => {
            pageNumbers.push(pagination.page);
            totalsFetched.push(pagination.totalFetched);
          },
        },
      });

      await paginator.take(25); // 3 pages

      expect(pageNumbers).toEqual([0, 1, 2]);
      expect(totalsFetched).toEqual([0, 10, 20]);
    });
  });

  describe('Error Handling', () => {
    it('should handle 404 errors gracefully', async () => {
      interface Response {
        data: MockRecord[];
      }

      const paginator = createPaginator<Response, MockRecord>({
        initialUrl: `${baseUrl}/nonexistent`,
        extractItems: (response) => response.data || [],
        getNextPageUrl: () => null,
        retry: { maxRetries: 0 },
      });

      await expect(paginator.toArray()).rejects.toThrow();
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      // Create a server with more records
      const largeServer = await createMockServer({
        totalRecords: 500,
        pageSize: 50,
      });

      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${largeServer.baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage
            ? `${largeServer.baseUrl}/records?page=${response.nextPage}`
            : null,
      });

      const startTime = Date.now();
      const allRecords = await paginator.toArray();
      const duration = Date.now() - startTime;

      expect(allRecords).toHaveLength(500);
      // Should complete in reasonable time (< 5 seconds for 10 pages)
      expect(duration).toBeLessThan(5000);

      await largeServer.stop();
    });

    it('should not fetch more pages than necessary with take()', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      let fetchCount = 0;

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
        hooks: {
          onAfterFetch: () => {
            fetchCount++;
          },
        },
      });

      // Take only 5 records (should only need 1 page fetch)
      const records = await paginator.take(5);

      expect(records).toHaveLength(5);
      expect(fetchCount).toBe(1);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle API with nested response structure', async () => {
      interface NestedResponse {
        data: MockRecord[];
        meta: {
          current_page: number;
          total_pages: number;
        };
      }

      const paginator = createPaginator<NestedResponse, MockRecord>({
        initialUrl: `${baseUrl}/page?page=1`,
        extractItems: (response) => response.data,
        getNextPageUrl: (response) => {
          const { current_page, total_pages } = response.meta;
          return current_page < total_pages
            ? `${baseUrl}/page?page=${current_page + 1}`
            : null;
        },
      });

      const records = await paginator.toArray();
      expect(records).toHaveLength(50);
    });

    it('should work with custom headers', async () => {
      interface SimpleResponse {
        records: MockRecord[];
        nextPage: number | null;
      }

      const paginator = createPaginator<SimpleResponse, MockRecord>({
        initialUrl: `${baseUrl}/records?page=1`,
        extractItems: (response) => response.records,
        getNextPageUrl: (response) =>
          response.nextPage ? `${baseUrl}/records?page=${response.nextPage}` : null,
        requestConfig: {
          headers: {
            'X-Custom-Header': 'test-value',
            Authorization: 'Bearer test-token',
          },
        },
      });

      const records = await paginator.take(10);
      expect(records).toHaveLength(10);
    });

    it('should collect unique records across pages', async () => {
      interface CursorResponse {
        data: MockRecord[];
        next_cursor: string | null;
      }

      const cursorStrategy = strategies.cursor<CursorResponse, MockRecord>({
        dataPath: 'data',
        cursorPath: 'next_cursor',
      });

      const paginator = createPaginator<CursorResponse, MockRecord>({
        initialUrl: `${baseUrl}/cursor`,
        ...cursorStrategy,
      });

      const allRecords = await paginator.toArray();
      const uniqueIds = new Set(allRecords.map((r) => r.id));

      // All IDs should be unique
      expect(uniqueIds.size).toBe(allRecords.length);
    });
  });
});
