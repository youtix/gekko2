import { Fetcher } from '@services/fetcher/fetcher.types';

export class MockFetcherService implements Fetcher {
  public static shouldThrowError: boolean = false;
  public static callHistory: {
    method: 'GET' | 'POST';
    url: string;
    payload?: any;
    timestamp: number;
  }[] = [];

  public static mockResponses: Map<string, any> = new Map();

  /**
   * Configure a specific response for a URL (partial match supported)
   */
  public static when(urlPart: string): { thenReturn: (response: any) => void } {
    return {
      thenReturn: (response: any) => {
        this.mockResponses.set(urlPart, response);
      },
    };
  }

  public static reset() {
    this.shouldThrowError = false;
    this.callHistory = [];
    this.mockResponses.clear();
  }

  async get<T>({ url }: { url: string; retries?: number; attempt?: number }): Promise<T> {
    return this.handleRequest('GET', url);
  }

  async post<T>({ url, payload }: { url: string; payload: unknown; retries?: number; attempt?: number }): Promise<T> {
    return this.handleRequest('POST', url, payload);
  }

  private async handleRequest(method: 'GET' | 'POST', url: string, payload?: any): Promise<any> {
    MockFetcherService.callHistory.push({
      method,
      url,
      payload,
      timestamp: Date.now(),
    });

    if (MockFetcherService.shouldThrowError) {
      throw new Error('Simulated Network Error');
    }

    // Check for specific mock responses
    for (const [key, response] of MockFetcherService.mockResponses) {
      if (url.includes(key)) {
        // If response is a function, evaluate it
        if (typeof response === 'function') {
          return response(url, payload);
        }
        return response;
      }
    }

    // Default response if no mock is found
    return { ok: true, result: [] };
  }
}
