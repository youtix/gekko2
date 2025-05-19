import { waitSync } from '@utils/process/process.utils';
import { closeSync, constants, openSync, unlinkSync } from 'fs';
import { LockSync } from './fs.types';

const getLockFileName = (targetPath: string): string => `${targetPath}.lock`;

const tryAcquire = (lockFile: string) => {
  try {
    const fd = openSync(lockFile, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR);
    closeSync(fd);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    return false;
  }
};

const attemptLock = (remaining: number, targetPath: string, retries: number, retryDelayMs: number) => {
  if (tryAcquire(getLockFileName(targetPath))) return;
  if (remaining === 0) throw new Error(`Could not acquire lock for ${targetPath} after ${retries + 1} attempts`);
  waitSync(retryDelayMs);
  attemptLock(remaining - 1, targetPath, retries, retryDelayMs);
};

export const lockSync: LockSync = (targetPath, { retries = 3, retryDelayMs = 50 } = {}) => {
  attemptLock(retries, targetPath, retries, retryDelayMs);

  return () => {
    try {
      unlinkSync(getLockFileName(targetPath));
    } catch {
      /* ignore */
    }
  };
};
