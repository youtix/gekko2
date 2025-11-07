import { addMinutes, startOfMinute, subMilliseconds } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { Time } from './date.types';
import { isDaterangeValid, resetDateParts, splitIntervals } from './date.utils';

describe('', () => {
  describe('resetDateParts', () => {
    it.each`
      date                                              | parts                    | expected
      ${new Date('2024-01-01T12:34:56.789Z').getTime()} | ${['h']}                 | ${new Date('2024-01-01T00:34:56.789Z').getTime()}
      ${new Date('2024-01-01T12:34:56.789Z').getTime()} | ${['m']}                 | ${new Date('2024-01-01T12:00:56.789Z').getTime()}
      ${new Date('2024-01-01T12:34:56.789Z').getTime()} | ${['s']}                 | ${new Date('2024-01-01T12:34:00.789Z').getTime()}
      ${new Date('2024-01-01T12:34:56.789Z').getTime()} | ${['ms']}                | ${new Date('2024-01-01T12:34:56.000Z').getTime()}
      ${new Date('2024-01-01T12:34:56.789Z').getTime()} | ${['h', 'm', 's', 'ms']} | ${new Date('2024-01-01T00:00:00.000Z').getTime()}
    `('resets $parts correctly', ({ date, parts, expected }) => {
      expect(resetDateParts(date, parts)).toBe(expected);
    });

    it('returns the same date if no parts are provided', () => {
      const date = new Date('2024-01-01T12:34:56.789Z').getTime();
      expect(resetDateParts(date, [])).toBe(date);
    });

    it('throws an error for invalid parts', () => {
      const date = new Date('2024-01-01T12:34:56.789Z').getTime();
      expect(() => resetDateParts(date, ['invalid' as Time])).toThrow();
    });
  });

  describe('isDaterangeValid', () => {
    it.each`
      startDate         | endDate           | expected
      ${undefined}      | ${undefined}      | ${false}
      ${null}           | ${null}           | ${false}
      ${''}             | ${''}             | ${false}
      ${'invalid-date'} | ${'2023-01-01'}   | ${false}
      ${'2023-01-01'}   | ${'invalid-date'} | ${false}
      ${'invalid-date'} | ${'invalid-date'} | ${false}
      ${'2023-12-31'}   | ${'2023-01-01'}   | ${false}
      ${'2023-05-15'}   | ${'2023-05-14'}   | ${false}
      ${'2023-01-01'}   | ${'2023-01-01'}   | ${false}
      ${'2023-01-01'}   | ${'2023-12-31'}   | ${true}
      ${'2023-05-14'}   | ${'2023-05-15'}   | ${true}
    `('returns $expected for startDate: $startDate and endDate: $endDate', ({ startDate, endDate, expected }) => {
      expect(isDaterangeValid(startDate, endDate)).toBe(expected);
    });
  });

  describe('splitIntervals', () => {
    const minute = 60 * 1000;

    it.each`
      startDate                 | endDate                   | expectedChunkCount | expectedDurations
      ${'2020-01-01T00:00:00Z'} | ${'2020-01-01T00:15:00Z'} | ${1}               | ${[16]}
      ${'2020-01-01T00:00:00Z'} | ${'2020-01-01T01:00:00Z'} | ${1}               | ${[61]}
      ${'2020-01-01T00:00:00Z'} | ${'2020-01-01T16:00:00Z'} | ${1}               | ${[961]}
      ${'2020-01-01T00:00:00Z'} | ${'2020-01-01T17:00:00Z'} | ${2}               | ${[1000, 21]}
      ${'2020-01-01T00:00:00Z'} | ${'2020-01-02T09:20:00Z'} | ${3}               | ${[1000, 1000, 1]}
    `(
      'splitting from $startDate to $endDate should yield $expectedChunkCount chunk(s)',
      ({ startDate, endDate, expectedChunkCount, expectedDurations }) => {
        const tsStart = new Date(startDate).getTime();
        const tsEnd = new Date(endDate).getTime();

        const alignedStart = startOfMinute(new Date(tsStart)).getTime();
        const alignedEnd = subMilliseconds(addMinutes(startOfMinute(new Date(tsEnd)), 1), 1).getTime();
        const intervals = splitIntervals(tsStart, tsEnd, 1000);

        expect(intervals).toHaveLength(expectedChunkCount);
        expect(intervals[0].start).toBe(alignedStart);
        expect(intervals[intervals.length - 1].end).toBe(alignedEnd);

        intervals.forEach((interval, index) => {
          const actualMinutes = (interval.end - interval.start + 1) / minute;
          const expectedMinutes = expectedDurations[index];
          expect(actualMinutes).toBe(expectedMinutes);
          if (index > 0) {
            expect(interval.start).toBe(intervals[index - 1].end + 1);
          }
        });
      },
    );
  });
});
