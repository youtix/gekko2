import { secondsToMilliseconds } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import packageJson from '../../../package.json';
import { toISOString, toTimestamp } from '../date/date.utils';
import { logVersion, processStartTime, wait, waitSync } from './process.utils';

describe('process', () => {
  describe('logVersion()', () => {
    afterEach(() => {
      Reflect.deleteProperty(process.versions, 'bun');
    });

    it('should include the package version', () => {
      const result = logVersion();
      expect(result).toContain(`v${packageJson.version}`);
    });

    it('should include the Bun version under the Bun label when running on Bun', () => {
      process.versions.bun = '1.3.14';
      const result = logVersion();
      expect(result).toContain('Bun version: v1.3.14');
    });

    it('should include the Node version under the Node label when not running on Bun', () => {
      const result = logVersion();
      expect(result).toContain(`Node version: ${process.version}`);
    });

    it('should not claim a Bun version when not running on Bun', () => {
      const result = logVersion();
      expect(result).not.toContain('Bun');
    });
  });

  describe('processStartTime()', () => {
    const fakeTime = toTimestamp('2020-01-01T00:00:00Z');
    const fakeUptimeSeconds = 100;

    beforeEach(() => {
      vi.useFakeTimers().setSystemTime(fakeTime);
      vi.spyOn(process, 'uptime').mockImplementation(() => fakeUptimeSeconds);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return the correct start time based on system time and process uptime', () => {
      const expected = fakeTime - secondsToMilliseconds(fakeUptimeSeconds);
      const result = processStartTime();
      expect(toISOString(result)).toBe(toISOString(expected));
    });
  });

  const advance = (ms: number) => vi.advanceTimersByTime(ms);

  describe('wait (async)', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('resolves after the specified delay', async () => {
      const promise = wait(500);

      // Nothing resolved yet
      let settled = false;
      promise.then(() => (settled = true));
      expect(settled).toBe(false);

      advance(499);
      expect(settled).toBe(false);

      advance(1);
      await expect(promise).resolves.toBeUndefined();
    });
  });

  describe('waitSync', () => {
    let atomicsSpy: MockInstance;

    beforeEach(() => {
      atomicsSpy = vi.spyOn(Atomics, 'wait').mockImplementation(() => 'ok');
    });

    afterEach(() => {
      atomicsSpy.mockRestore();
    });

    it('delegates to Atomics.wait with correct arguments', () => {
      waitSync(50);

      expect(atomicsSpy).toHaveBeenCalledTimes(1);
      const [shared, idx, val, delay] = atomicsSpy.mock.calls[0];
      expect(shared).toBeInstanceOf(Int32Array);
      expect(idx).toBe(0);
      expect(val).toBe(0);
      expect(delay).toBe(50);
    });

    it('returns immediately and does not call Atomics.wait when ms <= 0', () => {
      waitSync(0);
      waitSync(-5);

      expect(atomicsSpy).not.toHaveBeenCalled();
    });
  });
});
