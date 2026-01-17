export class ProxyExhaustionError extends Error {
  constructor(
    public readonly attemptedCount: number,
    public readonly lastError?: Error,
  ) {
    super(`All ${attemptedCount} proxies exhausted. Last error: ${lastError?.message ?? 'unknown'}`);
    this.name = 'ProxyExhaustionError';
  }
}
