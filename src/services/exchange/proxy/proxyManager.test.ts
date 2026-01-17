import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProxyConfig, WebshareProxyListResponse } from './proxy.types';
import { ProxyManager } from './proxyManager';
import { ProxyExhaustionError } from './proxyManager.error';

const mockFetch = vi.fn();

const createMockWebshareResponse = (count: number): WebshareProxyListResponse => ({
  count,
  next: null,
  previous: null,
  results: Array.from({ length: count }, (_, i) => ({
    id: `proxy-${i + 1}`,
    username: `user${i + 1}`,
    password: `pass${i + 1}`,
    proxy_address: `192.168.1.${i + 1}`,
    port: 8000 + i,
    valid: true,
    last_verification: new Date().toISOString(),
    country_code: 'US',
    city_name: 'New York',
    asn_name: 'Test ISP',
    asn_number: 12345,
    high_country_confidence: true,
    created_at: new Date().toISOString(),
  })),
});

const defaultConfig: ProxyConfig = {
  provider: 'webshare',
  apiKey: 'test-api-key',
  protocol: 'http',
};

describe('ProxyManager', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Initialization (AC1)', () => {
    it('fetches proxy list from Webshare API on initialize', async () => {
      const mockResponse = createMockWebshareResponse(5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('https://proxy.webshare.io/api/v2/proxy/list/'),
        expect.objectContaining({
          headers: {
            Authorization: 'Token test-api-key',
          },
        }),
      );
      expect(manager.isInitialized).toBe(true);
      expect(manager.proxyCount).toBe(5);
    });

    it('throws error for unsupported provider', async () => {
      const manager = new ProxyManager({
        ...defaultConfig,
        provider: 'unsupported' as any,
      });

      await expect(manager.initialize()).rejects.toThrow('Unsupported proxy provider');
    });

    it('throws error when API returns non-ok response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      const manager = new ProxyManager(defaultConfig);
      await expect(manager.initialize()).rejects.toThrow('Failed to fetch proxy list: 401');
    });

    it('throws error when no valid proxies are available', async () => {
      const mockResponse: WebshareProxyListResponse = {
        count: 2,
        next: null,
        previous: null,
        results: [
          { ...createMockWebshareResponse(1).results[0], valid: false },
          { ...createMockWebshareResponse(1).results[0], valid: false, id: 'proxy-2' },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await expect(manager.initialize()).rejects.toThrow('No valid proxies available');
    });

    it('filters out invalid proxies', async () => {
      const mockResponse: WebshareProxyListResponse = {
        count: 3,
        next: null,
        previous: null,
        results: [
          { ...createMockWebshareResponse(1).results[0], valid: true },
          { ...createMockWebshareResponse(1).results[0], valid: false, id: 'proxy-invalid' },
          { ...createMockWebshareResponse(1).results[0], valid: true, id: 'proxy-3' },
        ],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      expect(manager.proxyCount).toBe(2);
    });
  });

  describe('Round-Robin Rotation (AC2)', () => {
    it('rotates through all proxies in order', async () => {
      const mockResponse = createMockWebshareResponse(10);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      const usedProxies: string[] = [];
      for (let i = 0; i < 10; i++) {
        const proxy = manager.getNextProxy();
        usedProxies.push(proxy.host);
      }

      // All 10 should be different (each proxy used exactly once)
      const uniqueProxies = new Set(usedProxies);
      expect(uniqueProxies.size).toBe(10);
    });

    it('wraps around after exhausting all proxies', async () => {
      const mockResponse = createMockWebshareResponse(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      const firstProxy = manager.getNextProxy();
      manager.getNextProxy(); // 2nd
      manager.getNextProxy(); // 3rd
      const fourthProxy = manager.getNextProxy(); // Should wrap to 1st

      expect(fourthProxy.host).toBe(firstProxy.host);
    });

    it('throws error when calling getNextProxy before initialize', () => {
      const manager = new ProxyManager(defaultConfig);
      expect(() => manager.getNextProxy()).toThrow('ProxyManager not initialized');
    });
  });

  describe('Fetch with Retry (AC3)', () => {
    it('rotates to next proxy on failure and retries', async () => {
      const mockResponse = createMockWebshareResponse(5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      // Setup: first 2 proxies fail, 3rd succeeds
      mockFetch
        .mockRejectedValueOnce(new Error('Connection timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: 'success' }),
        });

      const response = await manager.fetch('https://example.com/api');

      // 5 calls: 1 for init, 3 for fetch attempts
      expect(mockFetch).toHaveBeenCalledTimes(4);
      expect(response.ok).toBe(true);
    });

    it('does not reuse failed proxy in same request sequence', async () => {
      const mockResponse = createMockWebshareResponse(5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      const calledProxyUrls: string[] = [];
      mockFetch.mockImplementation((url: string, options?: any) => {
        if (options?.proxy) {
          calledProxyUrls.push(options.proxy);
        }
        // First 3 fail, 4th succeeds
        if (calledProxyUrls.length < 4) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve({ ok: true });
      });

      await manager.fetch('https://example.com/api');

      // All proxy URLs should be unique
      const uniqueUrls = new Set(calledProxyUrls);
      expect(uniqueUrls.size).toBe(calledProxyUrls.length);
    });

    it('treats non-2xx responses as errors and retries', async () => {
      const mockResponse = createMockWebshareResponse(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 429, statusText: 'Too Many Requests' })
        .mockResolvedValueOnce({ ok: false, status: 503, statusText: 'Service Unavailable' })
        .mockResolvedValueOnce({ ok: true, status: 200 });

      const response = await manager.fetch('https://example.com/api');
      expect(response.ok).toBe(true);
    });
  });

  describe('Exhaustion Handling (AC4)', () => {
    it('throws ProxyExhaustionError after all proxies fail', async () => {
      const mockResponse = createMockWebshareResponse(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      // All 3 proxies fail
      mockFetch
        .mockRejectedValueOnce(new Error('Proxy 1 failed'))
        .mockRejectedValueOnce(new Error('Proxy 2 failed'))
        .mockRejectedValueOnce(new Error('Proxy 3 failed'));

      await expect(manager.fetch('https://example.com/api')).rejects.toThrow(ProxyExhaustionError);
    });

    it('includes attempt count and last error in ProxyExhaustionError', async () => {
      const mockResponse = createMockWebshareResponse(2);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      const lastErrorMessage = 'Final proxy connection failed';
      mockFetch.mockRejectedValueOnce(new Error('First error')).mockRejectedValueOnce(new Error(lastErrorMessage));

      try {
        await manager.fetch('https://example.com/api');
        expect.fail('Should have thrown ProxyExhaustionError');
      } catch (error) {
        expect(error).toBeInstanceOf(ProxyExhaustionError);
        const exhaustionError = error as ProxyExhaustionError;
        expect(exhaustionError.attemptedCount).toBe(2);
        expect(exhaustionError.lastError?.message).toBe(lastErrorMessage);
      }
    });

    it('throws error when fetch called without initialization', async () => {
      const manager = new ProxyManager(defaultConfig);

      await expect(manager.fetch('https://example.com/api')).rejects.toThrow('ProxyManager not initialized');
    });
  });

  describe('Configuration Options', () => {
    it('uses custom fetch timeout', async () => {
      const mockResponse = createMockWebshareResponse(1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig, { fetchTimeout: 5000 });
      await manager.initialize();

      mockFetch.mockResolvedValueOnce({ ok: true });

      await manager.fetch('https://example.com/api');

      // Check that AbortSignal.timeout was called (via the signal option)
      const lastCall = mockFetch.mock.calls.at(-1);
      expect(lastCall?.[1]?.signal).toBeDefined();
    });

    it('passes request options through to fetch', async () => {
      const mockResponse = createMockWebshareResponse(1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      mockFetch.mockResolvedValueOnce({ ok: true });

      await manager.fetch('https://example.com/api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });

      const lastCall = mockFetch.mock.calls.at(-1);
      expect(lastCall?.[1]?.method).toBe('POST');
      expect(lastCall?.[1]?.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('applies socks5 protocol from config', async () => {
      const socks5Config: ProxyConfig = {
        ...defaultConfig,
        protocol: 'socks5',
      };

      const mockResponse = createMockWebshareResponse(1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(socks5Config);
      await manager.initialize();

      const proxy = manager.getNextProxy();
      expect(proxy.protocol).toBe('socks5');
    });
  });

  describe('Edge Cases', () => {
    it('handles empty username/password in proxy', async () => {
      const mockResponse: WebshareProxyListResponse = {
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: 'proxy-1',
            username: '',
            password: '',
            proxy_address: '192.168.1.1',
            port: 8000,
            valid: true,
            last_verification: new Date().toISOString(),
            country_code: 'US',
            city_name: 'New York',
            asn_name: 'Test ISP',
            asn_number: 12345,
            high_country_confidence: true,
            created_at: new Date().toISOString(),
          },
        ],
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      mockFetch.mockResolvedValueOnce({ ok: true });
      await manager.fetch('https://example.com/api');

      const lastCall = mockFetch.mock.calls.at(-1);
      // Proxy URL should not include auth part for empty credentials
      expect(lastCall?.[1]?.proxy).toBe('http://192.168.1.1:8000');
    });

    it('handles single proxy correctly', async () => {
      const mockResponse = createMockWebshareResponse(1);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      const manager = new ProxyManager(defaultConfig);
      await manager.initialize();

      expect(manager.proxyCount).toBe(1);

      // Same proxy should be returned on wrap-around
      const first = manager.getNextProxy();
      const second = manager.getNextProxy();
      expect(first.host).toBe(second.host);
    });
  });
});
