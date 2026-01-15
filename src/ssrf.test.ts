import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSecureFetch, validateUrl, loadSsrfAgentGuard } from './ssrf.js';

describe('SSRF Protection', () => {
  describe('loadSsrfAgentGuard', () => {
    it('should load ssrf-agent-guard module', async () => {
      const ssrfAgentGuard = await loadSsrfAgentGuard();
      expect(ssrfAgentGuard).toBeDefined();
      expect(typeof ssrfAgentGuard).toBe('function');
    });

    it('should cache the module on subsequent calls', async () => {
      const firstLoad = await loadSsrfAgentGuard();
      const secondLoad = await loadSsrfAgentGuard();
      expect(firstLoad).toBe(secondLoad);
    });
  });

  describe('createSecureFetch', () => {
    it('should return base fetch when SSRF protection is disabled', async () => {
      const baseFetch = vi.fn().mockResolvedValue(new Response('{}'));
      const secureFetch = await createSecureFetch({ enabled: false }, baseFetch);

      expect(secureFetch).toBe(baseFetch);
    });

    it('should return a wrapped fetch when SSRF protection is enabled', async () => {
      const baseFetch = vi.fn().mockResolvedValue(new Response('{}'));
      const secureFetch = await createSecureFetch({ enabled: true }, baseFetch);

      expect(secureFetch).not.toBe(baseFetch);
      expect(typeof secureFetch).toBe('function');
    });

    it('should call base fetch with agent option when protection is enabled', async () => {
      const baseFetch = vi.fn().mockResolvedValue(new Response('{}'));
      const secureFetch = await createSecureFetch({ enabled: true }, baseFetch);

      await secureFetch('https://api.example.com/test', { method: 'GET' });

      expect(baseFetch).toHaveBeenCalledTimes(1);
      expect(baseFetch).toHaveBeenCalledWith(
        'https://api.example.com/test',
        expect.objectContaining({
          method: 'GET',
          agent: expect.anything(),
        })
      );
    });

    it('should handle URL object input', async () => {
      const baseFetch = vi.fn().mockResolvedValue(new Response('{}'));
      const secureFetch = await createSecureFetch({ enabled: true }, baseFetch);

      const url = new URL('https://api.example.com/test');
      await secureFetch(url);

      expect(baseFetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          agent: expect.anything(),
        })
      );
    });

    it('should pass custom options to ssrf-agent-guard', async () => {
      const baseFetch = vi.fn().mockResolvedValue(new Response('{}'));
      const secureFetch = await createSecureFetch(
        {
          enabled: true,
          options: { mode: 'block' },
        },
        baseFetch
      );

      await secureFetch('https://api.example.com/test');

      expect(baseFetch).toHaveBeenCalled();
    });
  });

  describe('validateUrl', () => {
    it('should return true for valid public URLs', async () => {
      const result = await validateUrl('https://api.example.com/data');
      expect(result).toBe(true);
    });

    it('should return true for valid HTTP URLs', async () => {
      const result = await validateUrl('http://api.example.com/data');
      expect(result).toBe(true);
    });

    // Note: ssrf-agent-guard validates URLs at request time, not at agent creation time
    // These tests verify that the validateUrl function creates an agent without error
    // Actual SSRF blocking happens when the agent is used to make a request

    it('should create agent for private IP addresses (blocks at request time)', async () => {
      // Agent creation succeeds; blocking happens at request time
      const result = await validateUrl('http://192.168.1.1/data');
      expect(result).toBe(true);
    });

    it('should create agent for localhost (blocks at request time)', async () => {
      const result = await validateUrl('http://localhost/data');
      expect(result).toBe(true);
    });

    it('should create agent for loopback address (blocks at request time)', async () => {
      const result = await validateUrl('http://127.0.0.1/data');
      expect(result).toBe(true);
    });

    it('should create agent for internal network addresses (blocks at request time)', async () => {
      const result = await validateUrl('http://10.0.0.1/data');
      expect(result).toBe(true);
    });

    it('should create agent for cloud metadata endpoints (blocks at request time)', async () => {
      const result = await validateUrl('http://169.254.169.254/latest/meta-data');
      expect(result).toBe(true);
    });
  });

  describe('Integration with LazyPaginator', () => {
    it('should work with ssrfProtection config option', async () => {
      // This is an integration test to verify the config is properly typed
      const { createPaginator } = await import('./index.js');

      // Mock fetch for this test
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({ items: [{ id: 1 }], next: null }),
        headers: new Map([['content-type', 'application/json']]),
      } as unknown as Response);

      const paginator = createPaginator({
        initialUrl: 'https://api.example.com/items',
        extractItems: (r: { items: { id: number }[] }) => r.items,
        getNextPageUrl: (r: { next: string | null }) => r.next,
        fetchFn: mockFetch,
        ssrfProtection: {
          enabled: true,
        },
      });

      const items = await paginator.toArray();
      expect(items).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalled();
    });
  });
});
