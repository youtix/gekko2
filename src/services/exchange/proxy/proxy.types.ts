/**
 * Proxy types for ProxyManager
 * @module services/exchange/proxy/proxy.types
 */

/**
 * Supported proxy providers
 */
export type ProxyProvider = 'webshare';

/**
 * Protocol types supported by proxies
 */
export type ProxyProtocol = 'http' | 'socks5';

/**
 * Individual proxy server configuration
 */
export interface ProxyServer {
  /** Proxy host/IP address */
  host: string;
  /** Proxy port */
  port: number;
  /** Authentication username (if required) */
  username?: string;
  /** Authentication password (if required) */
  password?: string;
  /** Protocol type */
  protocol: ProxyProtocol;
}

/**
 * Proxy configuration from user config
 */
export interface ProxyConfig {
  /** Proxy provider (currently only webshare supported) */
  provider: ProxyProvider;
  /** API key for the proxy provider */
  apiKey: string;
  /** Protocol to use (http or socks5) */
  protocol: ProxyProtocol;
}

/**
 * Webshare API response for proxy list endpoint
 * Based on: https://proxy.webshare.io/docs/api/#list-proxy
 */
export interface WebshareProxyListResponse {
  count: number;
  next: string | null;
  previous: string | null;
  results: WebshareProxy[];
}

/**
 * Individual proxy from Webshare API
 */
export interface WebshareProxy {
  id: string;
  username: string;
  password: string;
  proxy_address: string;
  port: number;
  valid: boolean;
  last_verification: string;
  country_code: string;
  city_name: string;
  asn_name: string;
  asn_number: number;
  high_country_confidence: boolean;
  created_at: string;
}
