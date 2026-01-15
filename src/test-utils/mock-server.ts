/**
 * Mock Pagination Server for Integration Testing
 *
 * A lightweight HTTP server that simulates various pagination patterns
 * for testing the lazy-api-paginator library.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from 'http';
import { AddressInfo } from 'net';

/**
 * Record type for mock data
 */
export interface MockRecord {
  id: number;
  name: string;
  email: string;
  createdAt: string;
}

/**
 * Configuration for the mock server
 */
export interface MockServerConfig {
  /** Total number of records to serve */
  totalRecords?: number;
  /** Number of records per page */
  pageSize?: number;
  /** Simulated latency in milliseconds */
  latency?: number;
  /** Port to listen on (0 for random available port) */
  port?: number;
}

/**
 * Generate mock records
 */
export function generateMockRecords(count: number): MockRecord[] {
  const records: MockRecord[] = [];
  for (let i = 1; i <= count; i++) {
    records.push({
      id: i,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      createdAt: new Date(Date.now() - i * 86400000).toISOString(),
    });
  }
  return records;
}

/**
 * Mock Pagination Server
 */
export class MockPaginationServer {
  private server: Server | null = null;
  private records: MockRecord[];
  private pageSize: number;
  private latency: number;
  private port: number;

  constructor(config: MockServerConfig = {}) {
    const {
      totalRecords = 100,
      pageSize = 10,
      latency = 0,
      port = 0,
    } = config;

    this.records = generateMockRecords(totalRecords);
    this.pageSize = pageSize;
    this.latency = latency;
    this.port = port;
  }

  /**
   * Start the mock server
   */
  async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', reject);

      this.server.listen(this.port, '127.0.0.1', () => {
        const address = this.server!.address() as AddressInfo;
        const baseUrl = `http://127.0.0.1:${address.port}`;
        resolve(baseUrl);
      });
    });
  }

  /**
   * Stop the mock server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /**
   * Handle incoming requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Simulate latency
    if (this.latency > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latency));
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const pathname = url.pathname;

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    try {
      switch (pathname) {
        case '/cursor':
          this.handleCursorPagination(url, res);
          break;
        case '/offset':
          this.handleOffsetPagination(url, res);
          break;
        case '/page':
          this.handlePageNumberPagination(url, res);
          break;
        case '/link-header':
          this.handleLinkHeaderPagination(url, req, res);
          break;
        case '/keyset':
          this.handleKeysetPagination(url, res);
          break;
        case '/records':
          this.handleSimplePagination(url, res);
          break;
        default:
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Cursor-based pagination (Slack/Stripe style)
   * GET /cursor?cursor=<base64_cursor>
   */
  private handleCursorPagination(url: URL, res: ServerResponse): void {
    const cursorParam = url.searchParams.get('cursor');
    let startIndex = 0;

    if (cursorParam) {
      try {
        startIndex = parseInt(Buffer.from(cursorParam, 'base64').toString('utf-8'), 10);
      } catch {
        startIndex = 0;
      }
    }

    const items = this.records.slice(startIndex, startIndex + this.pageSize);
    const nextIndex = startIndex + this.pageSize;
    const hasMore = nextIndex < this.records.length;

    const response = {
      data: items,
      next_cursor: hasMore ? Buffer.from(String(nextIndex)).toString('base64') : null,
      has_more: hasMore,
      total: this.records.length,
    };

    res.end(JSON.stringify(response));
  }

  /**
   * Offset-based pagination
   * GET /offset?offset=0&limit=10
   */
  private handleOffsetPagination(url: URL, res: ServerResponse): void {
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);
    const limit = parseInt(url.searchParams.get('limit') || String(this.pageSize), 10);

    const items = this.records.slice(offset, offset + limit);

    const response = {
      items,
      offset,
      limit,
      total: this.records.length,
      has_more: offset + limit < this.records.length,
    };

    res.end(JSON.stringify(response));
  }

  /**
   * Page number pagination (Laravel/Django style)
   * GET /page?page=1&per_page=10
   */
  private handlePageNumberPagination(url: URL, res: ServerResponse): void {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = parseInt(url.searchParams.get('per_page') || String(this.pageSize), 10);

    const startIndex = (page - 1) * perPage;
    const items = this.records.slice(startIndex, startIndex + perPage);
    const totalPages = Math.ceil(this.records.length / perPage);

    const response = {
      data: items,
      meta: {
        current_page: page,
        per_page: perPage,
        total: this.records.length,
        total_pages: totalPages,
        has_next: page < totalPages,
        has_prev: page > 1,
      },
    };

    res.end(JSON.stringify(response));
  }

  /**
   * Link header pagination (GitHub API style)
   * GET /link-header?page=1
   */
  private handleLinkHeaderPagination(url: URL, req: IncomingMessage, res: ServerResponse): void {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const perPage = this.pageSize;

    const startIndex = (page - 1) * perPage;
    const items = this.records.slice(startIndex, startIndex + perPage);
    const totalPages = Math.ceil(this.records.length / perPage);

    // Build Link header
    const baseUrl = `http://${req.headers.host}/link-header`;
    const links: string[] = [];

    if (page > 1) {
      links.push(`<${baseUrl}?page=1>; rel="first"`);
      links.push(`<${baseUrl}?page=${page - 1}>; rel="prev"`);
    }
    if (page < totalPages) {
      links.push(`<${baseUrl}?page=${page + 1}>; rel="next"`);
      links.push(`<${baseUrl}?page=${totalPages}>; rel="last"`);
    }

    if (links.length > 0) {
      res.setHeader('Link', links.join(', '));
    }

    res.end(JSON.stringify(items));
  }

  /**
   * Keyset/Seek pagination
   * GET /keyset?after=<id>
   */
  private handleKeysetPagination(url: URL, res: ServerResponse): void {
    const afterId = url.searchParams.get('after');
    let startIndex = 0;

    if (afterId) {
      const afterIdNum = parseInt(afterId, 10);
      startIndex = this.records.findIndex((r) => r.id === afterIdNum) + 1;
      if (startIndex === 0) {
        // ID not found, return empty
        res.end(JSON.stringify({ data: [], has_more: false }));
        return;
      }
    }

    const items = this.records.slice(startIndex, startIndex + this.pageSize);
    const hasMore = startIndex + this.pageSize < this.records.length;

    const response = {
      data: items,
      has_more: hasMore,
    };

    res.end(JSON.stringify(response));
  }

  /**
   * Simple pagination for basic testing
   * GET /records?page=1
   */
  private handleSimplePagination(url: URL, res: ServerResponse): void {
    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const startIndex = (page - 1) * this.pageSize;
    const items = this.records.slice(startIndex, startIndex + this.pageSize);
    const totalPages = Math.ceil(this.records.length / this.pageSize);

    const response = {
      records: items,
      page,
      totalPages,
      totalRecords: this.records.length,
      nextPage: page < totalPages ? page + 1 : null,
    };

    res.end(JSON.stringify(response));
  }
}

/**
 * Create and start a mock server with default configuration
 */
export async function createMockServer(config?: MockServerConfig): Promise<{
  server: MockPaginationServer;
  baseUrl: string;
  stop: () => Promise<void>;
}> {
  const server = new MockPaginationServer(config);
  const baseUrl = await server.start();

  return {
    server,
    baseUrl,
    stop: () => server.stop(),
  };
}
