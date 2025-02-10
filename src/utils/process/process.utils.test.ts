import { secondsToMilliseconds } from 'date-fns';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageJson from '../../../package.json';
import { toISOString, toTimestamp } from '../date/date.utils';
import { logVersion, processStartTime } from './process.utils';

describe('process', () => {
  describe('logVersion()', () => {
    it('should include the package version', () => {
      const result = logVersion();
      expect(result).toContain(`v${packageJson.version}`);
    });

    it('should include the process version', () => {
      const result = logVersion();
      expect(result).toContain(process.version);
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
});
