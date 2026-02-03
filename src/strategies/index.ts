import type { ItemExtractor, NextPageExtractor, PaginationState } from '../core/types.js';

/**
 * Helper to get a nested value from an object using dot notation
 * @example getByPath({ data: { items: [1, 2] } }, 'data.items') // [1, 2]
 */
export function getByPath<T = unknown>(obj: unknown, path: string): T | undefined {
  if (!path) return obj as T;
  const keys = path.split('.');
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current as T;
}

/**
 * Result from a strategy factory containing extractors for the paginator
 */
export interface StrategyResult<TResponse, TItem> {
  /** Function to extract items from response */
  extractItems: ItemExtractor<TResponse, TItem>;
  /** Function to get next page URL */
  getNextPageUrl: NextPageExtractor<TResponse>;
}

// ============================================================================
// Cursor-based Strategy (Slack, Stripe, etc.)
// ============================================================================

/**
 * Configuration for cursor-based pagination strategy
 */
export interface CursorStrategyConfig {
  /** Path to the data array in the response (e.g., 'data', 'data.items') */
  dataPath: string;
  /** Path to the cursor value in the response (e.g., 'next_cursor', 'meta.cursor') */
  cursorPath: string;
  /** Query parameter name for the cursor (default: 'cursor') */
  cursorParam?: string;
}

/**
 * Creates extractors for cursor-based pagination (Slack, Stripe style)
 *
 * @example
 * // API returns: { data: [...], next_cursor: "abc123" }
 * strategies.cursor({
 *   dataPath: 'data',
 *   cursorPath: 'next_cursor'
 * })
 */
export function cursor<TResponse, TItem>(
  config: CursorStrategyConfig
): StrategyResult<TResponse, TItem> {
  const { dataPath, cursorPath, cursorParam = 'cursor' } = config;

  return {
    extractItems: (response: TResponse): TItem[] => {
      const items = getByPath<TItem[]>(response, dataPath);
      return Array.isArray(items) ? items : [];
    },
    getNextPageUrl: (response: TResponse, pagination: PaginationState): string | null => {
      const nextCursor = getByPath<string>(response, cursorPath);
      if (!nextCursor) return null;

      const url = new URL(pagination.url);
      url.searchParams.set(cursorParam, nextCursor);
      return url.toString();
    },
  };
}

// ============================================================================
// Offset-based Strategy (Traditional REST APIs)
// ============================================================================

/**
 * Configuration for offset-based pagination strategy
 */
export interface OffsetStrategyConfig {
  /** Path to the data array in the response (e.g., 'items', 'data.results') */
  dataPath: string;
  /** Path to the total count in the response (e.g., 'total', 'meta.total') */
  totalPath: string;
  /** Number of items per page */
  pageSize: number;
  /** Query parameter name for offset (default: 'offset') */
  offsetParam?: string;
  /** Query parameter name for limit (default: 'limit') */
  limitParam?: string;
}

/**
 * Creates extractors for offset-based pagination
 *
 * @example
 * // API returns: { items: [...], total: 500 }
 * strategies.offset({
 *   dataPath: 'items',
 *   totalPath: 'total',
 *   pageSize: 100
 * })
 */
export function offset<TResponse, TItem>(
  config: OffsetStrategyConfig
): StrategyResult<TResponse, TItem> {
  const {
    dataPath,
    totalPath,
    pageSize,
    offsetParam = 'offset',
    limitParam = 'limit',
  } = config;

  return {
    extractItems: (response: TResponse): TItem[] => {
      const items = getByPath<TItem[]>(response, dataPath);
      return Array.isArray(items) ? items : [];
    },
    getNextPageUrl: (response: TResponse, pagination: PaginationState): string | null => {
      const total = getByPath<number>(response, totalPath);
      if (total === undefined || total === null) return null;

      const nextOffset = (pagination.page + 1) * pageSize;
      if (nextOffset >= total) return null;

      const url = new URL(pagination.url);
      url.searchParams.set(offsetParam, String(nextOffset));
      url.searchParams.set(limitParam, String(pageSize));
      return url.toString();
    },
  };
}

// ============================================================================
// Page Number Strategy (Laravel, Django, etc.)
// ============================================================================

/**
 * Configuration for page number-based pagination strategy
 */
export interface PageNumberStrategyConfig {
  /** Path to the data array in the response (e.g., 'results', 'data') */
  dataPath: string;
  /** Path to total pages in the response (e.g., 'total_pages', 'meta.last_page') */
  totalPagesPath?: string;
  /** Path to current page in the response (e.g., 'page', 'meta.current_page') */
  currentPagePath?: string;
  /** Path to boolean indicating if there's a next page (e.g., 'has_next', 'meta.has_more') */
  hasNextPath?: string;
  /** Query parameter name for page number (default: 'page') */
  pageParam?: string;
  /** Whether page numbers are 1-indexed (default: true) */
  oneIndexed?: boolean;
}

/**
 * Creates extractors for page number-based pagination (Laravel, Django style)
 *
 * @example
 * // API returns: { results: [...], total_pages: 10 }
 * strategies.pageNumber({
 *   dataPath: 'results',
 *   totalPagesPath: 'total_pages'
 * })
 *
 * @example
 * // API returns: { data: [...], has_more: true }
 * strategies.pageNumber({
 *   dataPath: 'data',
 *   hasNextPath: 'has_more'
 * })
 */
export function pageNumber<TResponse, TItem>(
  config: PageNumberStrategyConfig
): StrategyResult<TResponse, TItem> {
  const {
    dataPath,
    totalPagesPath,
    currentPagePath,
    hasNextPath,
    pageParam = 'page',
    oneIndexed = true,
  } = config;

  return {
    extractItems: (response: TResponse): TItem[] => {
      const items = getByPath<TItem[]>(response, dataPath);
      return Array.isArray(items) ? items : [];
    },
    getNextPageUrl: (response: TResponse, pagination: PaginationState): string | null => {
      // Determine current page (API response or from pagination state)
      let currentPage: number;
      if (currentPagePath) {
        const responsePage = getByPath<number>(response, currentPagePath);
        currentPage = responsePage ?? (oneIndexed ? pagination.page + 1 : pagination.page);
      } else {
        currentPage = oneIndexed ? pagination.page + 1 : pagination.page;
      }

      // Check if there's a next page
      let hasNext = false;

      if (hasNextPath) {
        hasNext = getByPath<boolean>(response, hasNextPath) === true;
      } else if (totalPagesPath) {
        const totalPages = getByPath<number>(response, totalPagesPath);
        if (totalPages !== undefined && totalPages !== null) {
          hasNext = currentPage < totalPages;
        }
      }

      if (!hasNext) return null;

      const nextPage = currentPage + 1;
      const url = new URL(pagination.url);
      url.searchParams.set(pageParam, String(nextPage));
      return url.toString();
    },
  };
}

// ============================================================================
// Link Header Strategy (GitHub API style)
// ============================================================================

/**
 * Configuration for Link header-based pagination strategy
 */
export interface LinkHeaderStrategyConfig {
  /** Path to the data array in the response (e.g., 'data', '' for root array) */
  dataPath?: string;
  /** Relation to look for in Link header (default: 'next') */
  rel?: string;
}

/**
 * Parses a Link header and extracts URLs by rel type
 * @example parseLinkHeader('<https://api.github.com/items?page=2>; rel="next"')
 */
export function parseLinkHeader(header: string): Record<string, string> {
  const links: Record<string, string> = {};
  const parts = header.split(',');

  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      links[match[2]] = match[1];
    }
  }

  return links;
}

/**
 * Creates extractors for Link header-based pagination (GitHub API style)
 *
 * Note: This strategy requires using the onAfterFetch hook to capture the Link header.
 * The strategy provides a helper function to set the next URL from the hook.
 *
 * @example
 * const linkStrategy = strategies.linkHeader({ dataPath: '' });
 *
 * const paginator = createPaginator({
 *   initialUrl: 'https://api.github.com/repos/owner/repo/issues',
 *   ...linkStrategy,
 *   hooks: {
 *     onAfterFetch: ({ response }) => {
 *       const linkHeader = response.headers['link'];
 *       if (linkHeader) {
 *         linkStrategy.setNextFromHeader(linkHeader);
 *       }
 *     }
 *   }
 * });
 */
export function linkHeader<TResponse, TItem>(
  config: LinkHeaderStrategyConfig = {}
): StrategyResult<TResponse, TItem> & {
  /** Call this from onAfterFetch hook with the Link header value */
  setNextFromHeader: (header: string) => void;
  /** Call this from onAfterFetch to directly set the next URL */
  setNextUrl: (url: string | null) => void;
} {
  const { dataPath = '', rel = 'next' } = config;

  // Instance-specific next URL storage
  let nextUrl: string | null = null;

  return {
    extractItems: (response: TResponse): TItem[] => {
      if (!dataPath) {
        return Array.isArray(response) ? (response as TItem[]) : [];
      }
      const items = getByPath<TItem[]>(response, dataPath);
      return Array.isArray(items) ? items : [];
    },
    getNextPageUrl: (): string | null => {
      const url = nextUrl;
      nextUrl = null; // Reset after reading
      return url;
    },
    setNextFromHeader: (header: string): void => {
      const links = parseLinkHeader(header);
      nextUrl = links[rel] ?? null;
    },
    setNextUrl: (url: string | null): void => {
      nextUrl = url;
    },
  };
}

// ============================================================================
// Keyset/Seek Strategy (Efficient for large datasets)
// ============================================================================

/**
 * Configuration for keyset/seek pagination strategy
 */
export interface KeysetStrategyConfig {
  /** Path to the data array in the response */
  dataPath: string;
  /** Path to the field used as the key in each item (e.g., 'id', 'created_at') */
  keyPath: string;
  /** Query parameter name for the "after" key (default: 'after') */
  afterParam?: string;
  /** Path in response indicating if there are more items (optional) */
  hasMorePath?: string;
  /** Minimum items expected per page - if fewer returned, pagination stops (optional) */
  minPageSize?: number;
}

/**
 * Creates extractors for keyset/seek pagination (efficient for large datasets)
 *
 * @example
 * // API returns: { data: [{ id: 1 }, { id: 2 }], has_more: true }
 * strategies.keyset({
 *   dataPath: 'data',
 *   keyPath: 'id',
 *   hasMorePath: 'has_more'
 * })
 */
export function keyset<TResponse, TItem>(
  config: KeysetStrategyConfig
): StrategyResult<TResponse, TItem> {
  const {
    dataPath,
    keyPath,
    afterParam = 'after',
    hasMorePath,
    minPageSize,
  } = config;

  return {
    extractItems: (response: TResponse): TItem[] => {
      const items = getByPath<TItem[]>(response, dataPath);
      return Array.isArray(items) ? items : [];
    },
    getNextPageUrl: (response: TResponse, pagination: PaginationState): string | null => {
      const items = getByPath<TItem[]>(response, dataPath);
      if (!Array.isArray(items) || items.length === 0) return null;

      // Check hasMore if provided
      if (hasMorePath) {
        const hasMore = getByPath<boolean>(response, hasMorePath);
        if (hasMore === false) return null;
      }

      // Check minimum page size
      if (minPageSize !== undefined && items.length < minPageSize) {
        return null;
      }

      // Get the last item's key value
      const lastItem = items[items.length - 1];
      const lastKey = getByPath<string | number>(lastItem, keyPath);
      if (lastKey === undefined || lastKey === null) return null;

      const url = new URL(pagination.url);
      url.searchParams.set(afterParam, String(lastKey));
      return url.toString();
    },
  };
}

// ============================================================================
// Exported strategies object
// ============================================================================

/**
 * Built-in pagination strategies for common API patterns
 */
export const strategies = {
  cursor,
  offset,
  pageNumber,
  linkHeader,
  keyset,
  /** Utility to parse Link headers */
  parseLinkHeader,
  /** Utility to access nested object properties by path */
  getByPath,
};
