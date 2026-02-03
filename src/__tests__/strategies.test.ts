import { describe, it, expect } from 'vitest';
import {
  strategies,
  getByPath,
  parseLinkHeader,
  cursor,
  offset,
  pageNumber,
  linkHeader,
  keyset,
} from '../strategies/index.js';
import type { PaginationState } from '../core/types.js';

// Helper to create pagination state
function createPaginationState(overrides: Partial<PaginationState> = {}): PaginationState {
  return {
    page: 0,
    totalFetched: 0,
    isFirstPage: true,
    url: 'https://api.example.com/items',
    ...overrides,
  };
}

describe('strategies', () => {
  describe('getByPath', () => {
    it('should get top-level property', () => {
      const obj = { name: 'test' };
      expect(getByPath(obj, 'name')).toBe('test');
    });

    it('should get nested property', () => {
      const obj = { data: { items: [1, 2, 3] } };
      expect(getByPath(obj, 'data.items')).toEqual([1, 2, 3]);
    });

    it('should get deeply nested property', () => {
      const obj = { a: { b: { c: { d: 'deep' } } } };
      expect(getByPath(obj, 'a.b.c.d')).toBe('deep');
    });

    it('should return undefined for non-existent path', () => {
      const obj = { name: 'test' };
      expect(getByPath(obj, 'missing')).toBeUndefined();
    });

    it('should return undefined for non-existent nested path', () => {
      const obj = { data: { items: [] } };
      expect(getByPath(obj, 'data.missing.path')).toBeUndefined();
    });

    it('should return the object itself for empty path', () => {
      const obj = { name: 'test' };
      expect(getByPath(obj, '')).toEqual(obj);
    });

    it('should handle null values in path', () => {
      const obj = { data: null };
      expect(getByPath(obj, 'data.items')).toBeUndefined();
    });

    it('should handle undefined values in path', () => {
      const obj = { data: undefined };
      expect(getByPath(obj, 'data.items')).toBeUndefined();
    });
  });

  describe('parseLinkHeader', () => {
    it('should parse single link', () => {
      const header = '<https://api.example.com?page=2>; rel="next"';
      expect(parseLinkHeader(header)).toEqual({
        next: 'https://api.example.com?page=2',
      });
    });

    it('should parse multiple links', () => {
      const header =
        '<https://api.example.com?page=2>; rel="next", <https://api.example.com?page=10>; rel="last"';
      expect(parseLinkHeader(header)).toEqual({
        next: 'https://api.example.com?page=2',
        last: 'https://api.example.com?page=10',
      });
    });

    it('should parse full GitHub-style Link header', () => {
      const header =
        '<https://api.github.com/repos?page=1>; rel="first", <https://api.github.com/repos?page=2>; rel="prev", <https://api.github.com/repos?page=4>; rel="next", <https://api.github.com/repos?page=10>; rel="last"';
      expect(parseLinkHeader(header)).toEqual({
        first: 'https://api.github.com/repos?page=1',
        prev: 'https://api.github.com/repos?page=2',
        next: 'https://api.github.com/repos?page=4',
        last: 'https://api.github.com/repos?page=10',
      });
    });

    it('should return empty object for empty string', () => {
      expect(parseLinkHeader('')).toEqual({});
    });

    it('should handle malformed link headers gracefully', () => {
      const header = 'not a valid link header';
      expect(parseLinkHeader(header)).toEqual({});
    });
  });

  describe('cursor strategy', () => {
    it('should extract items from dataPath', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'next_cursor' });
      const response = { data: [{ id: 1 }, { id: 2 }], next_cursor: 'abc' };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should extract items from nested dataPath', () => {
      const strategy = cursor({ dataPath: 'response.data.items', cursorPath: 'cursor' });
      const response = { response: { data: { items: [{ id: 1 }] } }, cursor: 'abc' };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }]);
    });

    it('should return empty array when dataPath not found', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'cursor' });
      const response = { items: [{ id: 1 }] };

      expect(strategy.extractItems(response)).toEqual([]);
    });

    it('should return empty array when data is not an array', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'cursor' });
      const response = { data: 'not an array' };

      expect(strategy.extractItems(response)).toEqual([]);
    });

    it('should return next page URL with cursor', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'next_cursor' });
      const response = { data: [], next_cursor: 'abc123' };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?cursor=abc123');
    });

    it('should use custom cursor param name', () => {
      const strategy = cursor({
        dataPath: 'data',
        cursorPath: 'next_cursor',
        cursorParam: 'after',
      });
      const response = { data: [], next_cursor: 'abc123' };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=abc123');
    });

    it('should return null when cursor is not present', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'next_cursor' });
      const response = { data: [], next_cursor: null };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return null when cursor is empty string', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'next_cursor' });
      const response = { data: [], next_cursor: '' };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should handle nested cursor path', () => {
      const strategy = cursor({
        dataPath: 'data',
        cursorPath: 'meta.pagination.next_cursor',
      });
      const response = { data: [], meta: { pagination: { next_cursor: 'xyz' } } };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?cursor=xyz');
    });

    it('should preserve existing query params', () => {
      const strategy = cursor({ dataPath: 'data', cursorPath: 'next_cursor' });
      const response = { data: [], next_cursor: 'abc123' };
      const pagination = createPaginationState({
        url: 'https://api.example.com/items?limit=50&filter=active',
      });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toContain('limit=50');
      expect(nextUrl).toContain('filter=active');
      expect(nextUrl).toContain('cursor=abc123');
    });
  });

  describe('offset strategy', () => {
    it('should extract items from dataPath', () => {
      const strategy = offset({ dataPath: 'items', totalPath: 'total', pageSize: 10 });
      const response = { items: [{ id: 1 }, { id: 2 }], total: 100 };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return next page URL when more items exist', () => {
      const strategy = offset({ dataPath: 'items', totalPath: 'total', pageSize: 10 });
      const response = { items: [], total: 100 };
      const pagination = createPaginationState({ page: 0 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?offset=10&limit=10');
    });

    it('should return null when all items have been fetched', () => {
      const strategy = offset({ dataPath: 'items', totalPath: 'total', pageSize: 10 });
      const response = { items: [], total: 20 };
      const pagination = createPaginationState({ page: 1 }); // offset would be 20

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should use custom offset and limit param names', () => {
      const strategy = offset({
        dataPath: 'items',
        totalPath: 'total',
        pageSize: 25,
        offsetParam: 'skip',
        limitParam: 'take',
      });
      const response = { items: [], total: 100 };
      const pagination = createPaginationState({ page: 1 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?skip=50&take=25');
    });

    it('should handle nested total path', () => {
      const strategy = offset({
        dataPath: 'data.items',
        totalPath: 'meta.total_count',
        pageSize: 10,
      });
      const response = { data: { items: [] }, meta: { total_count: 50 } };
      const pagination = createPaginationState({ page: 2 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?offset=30&limit=10');
    });

    it('should return null when total is undefined', () => {
      const strategy = offset({ dataPath: 'items', totalPath: 'total', pageSize: 10 });
      const response = { items: [] };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return null when total is null', () => {
      const strategy = offset({ dataPath: 'items', totalPath: 'total', pageSize: 10 });
      const response = { items: [], total: null };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });
  });

  describe('pageNumber strategy', () => {
    it('should extract items from dataPath', () => {
      const strategy = pageNumber({ dataPath: 'results', totalPagesPath: 'total_pages' });
      const response = { results: [{ id: 1 }], total_pages: 5 };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }]);
    });

    it('should return next page URL using totalPagesPath', () => {
      const strategy = pageNumber({ dataPath: 'results', totalPagesPath: 'total_pages' });
      const response = { results: [], total_pages: 5 };
      const pagination = createPaginationState({ page: 0 }); // current page 1 (one-indexed)

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?page=2');
    });

    it('should return null when on last page (totalPagesPath)', () => {
      const strategy = pageNumber({ dataPath: 'results', totalPagesPath: 'total_pages' });
      const response = { results: [], total_pages: 3 };
      const pagination = createPaginationState({ page: 2 }); // current page 3 (one-indexed)

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return next page URL using hasNextPath', () => {
      const strategy = pageNumber({ dataPath: 'data', hasNextPath: 'has_more' });
      const response = { data: [], has_more: true };
      const pagination = createPaginationState({ page: 0 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?page=2');
    });

    it('should return null when hasNext is false', () => {
      const strategy = pageNumber({ dataPath: 'data', hasNextPath: 'has_more' });
      const response = { data: [], has_more: false };
      const pagination = createPaginationState({ page: 5 });

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should use custom page param name', () => {
      const strategy = pageNumber({
        dataPath: 'data',
        totalPagesPath: 'pages',
        pageParam: 'p',
      });
      const response = { data: [], pages: 10 };
      const pagination = createPaginationState({ page: 2 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?p=4');
    });

    it('should handle zero-indexed pages', () => {
      const strategy = pageNumber({
        dataPath: 'data',
        totalPagesPath: 'total_pages',
        oneIndexed: false,
      });
      const response = { data: [], total_pages: 5 };
      const pagination = createPaginationState({ page: 2 }); // 0-indexed page 2

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?page=3');
    });

    it('should use currentPagePath from response', () => {
      const strategy = pageNumber({
        dataPath: 'data',
        totalPagesPath: 'meta.last_page',
        currentPagePath: 'meta.current_page',
      });
      const response = { data: [], meta: { current_page: 3, last_page: 10 } };
      const pagination = createPaginationState({ page: 2 });

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?page=4');
    });

    it('should return null when no totalPagesPath or hasNextPath', () => {
      const strategy = pageNumber({ dataPath: 'data' });
      const response = { data: [] };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });
  });

  describe('linkHeader strategy', () => {
    it('should extract items from root array when dataPath is empty', () => {
      const strategy = linkHeader({ dataPath: '' });
      const response = [{ id: 1 }, { id: 2 }];

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should extract items from dataPath', () => {
      const strategy = linkHeader({ dataPath: 'data' });
      const response = { data: [{ id: 1 }] };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }]);
    });

    it('should return null initially when no next URL set', () => {
      const strategy = linkHeader();
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return next URL after setNextFromHeader is called', () => {
      const strategy = linkHeader();
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      strategy.setNextFromHeader('<https://api.example.com?page=2>; rel="next"');
      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com?page=2');
    });

    it('should clear next URL after reading', () => {
      const strategy = linkHeader();
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      strategy.setNextFromHeader('<https://api.example.com?page=2>; rel="next"');
      strategy.getNextPageUrl(response, pagination); // First read
      const secondRead = strategy.getNextPageUrl(response, pagination);

      expect(secondRead).toBeNull();
    });

    it('should allow directly setting next URL', () => {
      const strategy = linkHeader();
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      strategy.setNextUrl('https://custom.url.com/next');
      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://custom.url.com/next');
    });

    it('should use custom rel', () => {
      const strategy = linkHeader({ rel: 'following' });
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      strategy.setNextFromHeader(
        '<https://api.example.com?page=2>; rel="next", <https://api.example.com?page=3>; rel="following"'
      );
      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com?page=3');
    });

    it('should return null when rel not found in header', () => {
      const strategy = linkHeader({ rel: 'next' });
      const response = [{ id: 1 }];
      const pagination = createPaginationState();

      strategy.setNextFromHeader('<https://api.example.com?page=1>; rel="prev"');
      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBeNull();
    });
  });

  describe('keyset strategy', () => {
    it('should extract items from dataPath', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id' });
      const response = { data: [{ id: 1 }, { id: 2 }] };

      expect(strategy.extractItems(response)).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should return next page URL with last item key', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id' });
      const response = { data: [{ id: 1 }, { id: 2 }, { id: 3 }] };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=3');
    });

    it('should use custom afterParam', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id', afterParam: 'since_id' });
      const response = { data: [{ id: 100 }] };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?since_id=100');
    });

    it('should handle nested keyPath', () => {
      const strategy = keyset({ dataPath: 'items', keyPath: 'meta.cursor' });
      const response = { items: [{ meta: { cursor: 'abc' } }, { meta: { cursor: 'xyz' } }] };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=xyz');
    });

    it('should return null when data is empty', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id' });
      const response = { data: [] };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return null when hasMorePath is false', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id', hasMorePath: 'has_more' });
      const response = { data: [{ id: 1 }], has_more: false };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return next URL when hasMorePath is true', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id', hasMorePath: 'has_more' });
      const response = { data: [{ id: 1 }], has_more: true };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=1');
    });

    it('should return null when items less than minPageSize', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id', minPageSize: 10 });
      const response = { data: [{ id: 1 }, { id: 2 }] }; // Only 2 items
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should return next URL when items equal minPageSize', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'id', minPageSize: 2 });
      const response = { data: [{ id: 1 }, { id: 2 }] };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=2');
    });

    it('should return null when last item key is undefined', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'missing' });
      const response = { data: [{ id: 1 }] };
      const pagination = createPaginationState();

      expect(strategy.getNextPageUrl(response, pagination)).toBeNull();
    });

    it('should handle string keys', () => {
      const strategy = keyset({ dataPath: 'data', keyPath: 'cursor' });
      const response = { data: [{ cursor: 'abc' }, { cursor: 'xyz' }] };
      const pagination = createPaginationState();

      const nextUrl = strategy.getNextPageUrl(response, pagination);

      expect(nextUrl).toBe('https://api.example.com/items?after=xyz');
    });
  });

  describe('strategies object exports', () => {
    it('should export cursor strategy', () => {
      expect(strategies.cursor).toBe(cursor);
    });

    it('should export offset strategy', () => {
      expect(strategies.offset).toBe(offset);
    });

    it('should export pageNumber strategy', () => {
      expect(strategies.pageNumber).toBe(pageNumber);
    });

    it('should export linkHeader strategy', () => {
      expect(strategies.linkHeader).toBe(linkHeader);
    });

    it('should export keyset strategy', () => {
      expect(strategies.keyset).toBe(keyset);
    });

    it('should export parseLinkHeader utility', () => {
      expect(strategies.parseLinkHeader).toBe(parseLinkHeader);
    });

    it('should export getByPath utility', () => {
      expect(strategies.getByPath).toBe(getByPath);
    });
  });
});
