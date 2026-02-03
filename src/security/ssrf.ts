/**
 * SSRF Protection utilities for lazy-api-paginator
 * Requires ssrf-agent-guard package: npm install ssrf-agent-guard
 */

import type { SsrfProtectionConfig } from '../core/types.js';

/**
 * Type for the ssrf-agent-guard module
 */
type SsrfAgentGuard = (url: string, options?: Record<string, unknown>) => unknown;

/**
 * Cached ssrf-agent-guard module
 */
let ssrfAgentGuardModule: SsrfAgentGuard | null = null;

/**
 * Dynamically loads ssrf-agent-guard module
 * @throws Error if ssrf-agent-guard is not installed
 */
export async function loadSsrfAgentGuard(): Promise<SsrfAgentGuard> {
  if (ssrfAgentGuardModule) {
    return ssrfAgentGuardModule;
  }

  try {
    const module = await import('ssrf-agent-guard');
    ssrfAgentGuardModule = module.default || module;
    return ssrfAgentGuardModule;
  } catch {
    throw new Error(
      'ssrf-agent-guard is required for SSRF protection. ' +
        'Install it with: npm install ssrf-agent-guard'
    );
  }
}

/**
 * Creates a fetch function with SSRF protection enabled
 *
 * @param config - SSRF protection configuration
 * @param baseFetch - Base fetch function to wrap (defaults to global fetch)
 * @returns A fetch function with SSRF protection
 *
 * @example
 * ```typescript
 * import { createSecureFetch, createPaginator } from 'lazy-api-paginator';
 *
 * const secureFetch = await createSecureFetch({ enabled: true });
 *
 * const paginator = createPaginator({
 *   initialUrl: 'https://api.example.com/data',
 *   extractItems: (r) => r.items,
 *   getNextPageUrl: (r) => r.next,
 *   fetchFn: secureFetch,
 * });
 * ```
 */
export async function createSecureFetch(
  config: SsrfProtectionConfig,
  baseFetch: typeof fetch = fetch
): Promise<typeof fetch> {
  if (!config.enabled) {
    return baseFetch;
  }

  const ssrfAgentGuard = await loadSsrfAgentGuard();

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    // Create the SSRF-protected agent
    const agent = ssrfAgentGuard(url, config.options);

    // Merge the agent into the request options
    const secureInit: RequestInit & { agent?: unknown } = {
      ...init,
      agent,
    };

    return baseFetch(input, secureInit as RequestInit);
  };
}

/**
 * Validates a URL for SSRF vulnerabilities without making a request
 *
 * @param url - The URL to validate
 * @param options - Optional ssrf-agent-guard options
 * @returns true if the URL is safe, throws an error if blocked
 *
 * @example
 * ```typescript
 * import { validateUrl } from 'lazy-api-paginator';
 *
 * try {
 *   await validateUrl('https://api.example.com/data');
 *   console.log('URL is safe');
 * } catch (error) {
 *   console.error('URL blocked:', error.message);
 * }
 * ```
 */
export async function validateUrl(
  url: string,
  options?: Record<string, unknown>
): Promise<boolean> {
  const ssrfAgentGuard = await loadSsrfAgentGuard();

  // Create an agent to trigger validation
  // ssrf-agent-guard validates the URL when creating the agent
  ssrfAgentGuard(url, options);

  return true;
}
