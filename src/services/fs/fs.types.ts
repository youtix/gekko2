export interface LockSyncOptions {
  /** How many retries after the initial attempt (default = 3) */
  retries?: number;
  /** Milliseconds to sleep between attempts (default = 50 ms) */
  retryDelayMs?: number;
}
export type LockSync = (targetPath: string, options?: LockSyncOptions) => () => void;

export type Fs = { lockSync: LockSync };
