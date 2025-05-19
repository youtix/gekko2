import { closeSync, openSync, unlinkSync } from 'fs';
import { Mock, describe, expect, it, vi } from 'vitest';
import { waitSync } from '../../utils/process/process.utils';
import { lockSync } from './fs.service';

vi.mock('fs', () => ({
  openSync: vi.fn(),
  closeSync: vi.fn(),
  unlinkSync: vi.fn(),
  constants: {
    O_CREAT: 1,
    O_EXCL: 2,
    O_RDWR: 4,
  },
}));

vi.mock('@utils/process/process.utils', () => ({
  waitSync: vi.fn(),
}));

describe('lockSync', () => {
  const target = '/tmp/test.csv';
  const mockFd = 123;

  it('should acquires the lock immediately and releases it', () => {
    (openSync as Mock).mockReturnValue(mockFd);

    const release = lockSync(target);

    expect(openSync).toHaveBeenCalledTimes(1);
    expect(closeSync).toHaveBeenCalledWith(mockFd);
    expect(waitSync).not.toHaveBeenCalled();

    release();
    expect(unlinkSync).toHaveBeenCalledWith(`${target}.lock`);
  });

  it('should retries when the lock already exists then succeeds', () => {
    const err = Object.assign(new Error('exists'), { code: 'EEXIST' });
    (openSync as Mock)
      .mockImplementationOnce(() => {
        throw err;
      })
      .mockReturnValue(mockFd);

    const release = lockSync(target, { retries: 1, retryDelayMs: 20 });

    expect(openSync).toHaveBeenCalledTimes(2);
    expect(waitSync).toHaveBeenCalledWith(20);

    release();
    expect(unlinkSync).toHaveBeenCalledWith(`${target}.lock`);
  });

  it('should throws when retries are exhausted', () => {
    const err = Object.assign(new Error('exists'), { code: 'EEXIST' });
    (openSync as Mock).mockImplementation(() => {
      throw err;
    });

    expect(() => lockSync(target, { retries: 2, retryDelayMs: 10 })).toThrow(/Could not acquire lock/);
    expect(openSync).toHaveBeenCalledTimes(3);
  });
});
