import type { ProxyConfig, ProxyServer, WebshareProxyListResponse } from './proxy.types';
import { WEBSHARE_API_BASE } from './proxyManager.const';
import { ProxyExhaustionError } from './proxyManager.error';

export interface ProxyManagerOptions {
  /** Timeout for each fetch request in milliseconds */
  fetchTimeout?: number;
}

/**
 * Manages a pool of proxy servers with round-robin rotation and automatic retry logic.
 *
 * Features:
 * - Proactive round-robin rotation: each request uses a different proxy
 * - Automatic retry on failure using next proxy
 * - Exhaustion handling: throws after all proxies are tried
 */
export class ProxyManager {
  private proxies: ProxyServer[] = [];
  private currentIndex = 0;
  private config: ProxyConfig;
  private options: ProxyManagerOptions;
  private initialized = false;

  constructor(config: ProxyConfig, options: ProxyManagerOptions = {}) {
    this.config = config;
    this.options = {
      fetchTimeout: options.fetchTimeout ?? 30000,
    };
  }

  /**
   * Fetches the proxy list from the provider and initializes the manager
   * @throws Error if the provider is not supported or the API call fails
   */
  async initialize(): Promise<void> {
    if (this.config.provider !== 'webshare') {
      throw new Error(`Unsupported proxy provider: ${this.config.provider}`);
    }

    let nextUrl: string | null = `${WEBSHARE_API_BASE}/proxy/list/?mode=direct&page=1&page_size=100`;
    const allProxies: WebshareProxyListResponse['results'] = [];

    while (nextUrl) {
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Token ${this.config.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch proxy list: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as WebshareProxyListResponse;
      allProxies.push(...data.results);
      nextUrl = data.next;
    }

    this.proxies = allProxies
      .filter(proxy => proxy.valid)
      .map(proxy => ({
        host: proxy.proxy_address,
        port: proxy.port,
        username: proxy.username,
        password: proxy.password,
        protocol: this.config.protocol,
      }));

    if (this.proxies.length === 0) {
      throw new Error('No valid proxies available from provider');
    }

    this.currentIndex = 0;
    this.initialized = true;
  }

  /**
   * Gets the next proxy in round-robin rotation
   * @returns The next proxy server configuration
   */
  getNextProxy(): ProxyServer {
    if (!this.initialized || this.proxies.length === 0) {
      throw new Error('ProxyManager not initialized or no proxies available');
    }

    const proxy = this.proxies[this.currentIndex];
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    return proxy;
  }

  /**
   * Fetches a URL using proxy rotation with automatic retry on failure.
   * Each retry uses the next proxy in rotation until all are exhausted.
   *
   * @param url - The URL to fetch
   * @param options - Fetch options (method, headers, body, etc.)
   * @returns The fetch response
   * @throws ProxyExhaustionError if all proxies fail
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    if (!this.initialized) {
      throw new Error('ProxyManager not initialized. Call initialize() first.');
    }

    const maxAttempts = this.proxies.length;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const proxy = this.getNextProxy();

      try {
        const response = await this.fetchWithProxy(url, proxy, options);
        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        // Continue to next proxy
      }
    }

    throw new ProxyExhaustionError(maxAttempts, lastError);
  }

  /**
   * Executes a fetch request through a specific proxy
   */
  private async fetchWithProxy(url: string, proxy: ProxyServer, options: RequestInit): Promise<Response> {
    // Build the proxy URL for Bun's native fetch
    const proxyAuth =
      proxy.username && proxy.password
        ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password)}@`
        : '';
    const proxyUrl = `${proxy.protocol}://${proxyAuth}${proxy.host}:${proxy.port}`;

    // Bun supports the 'proxy' option in fetch natively
    const fetchOptions: RequestInit & { proxy?: string } = {
      ...options,
      proxy: proxyUrl,
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(this.options.fetchTimeout!)])
        : AbortSignal.timeout(this.options.fetchTimeout!),
    };

    const response = await fetch(url, fetchOptions);

    // Treat non-2xx responses as errors to trigger retry
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response;
  }

  /**
   * Returns the number of available proxies
   */
  get proxyCount(): number {
    return this.proxies.length;
  }

  /**
   * Returns whether the manager has been initialized
   */
  get isInitialized(): boolean {
    return this.initialized;
  }
}
