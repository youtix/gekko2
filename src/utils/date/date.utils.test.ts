import { addMinutes, startOfMinute, subMilliseconds } from 'date-fns';
import { describe, expect, it } from 'vitest';
import { isDaterangeValid, splitIntervals, toISOString } from './date.utils';

describe('', () => {
  describe('toISOString', () => {
    // Date.prototype.toISOString throws a RangeError on a date that is not one: a message or a report built with it must not throw
    it.each`
      description                                  | timestamp        | expected
      ${'a timestamp'}                             | ${1704346468838} | ${'2024-01-04T05:34:28.838Z'}
      ${'the epoch'}                               | ${0}             | ${'1970-01-01T00:00:00.000Z'}
      ${'the last date there is'}                  | ${8.64e15}       | ${'+275760-09-13T00:00:00.000Z'}
      ${'no timestamp'}                            | ${undefined}     | ${'Unknown Date'}
      ${'null'}                                    | ${null}          | ${'Unknown Date'}
      ${'NaN'}                                     | ${Number.NaN}    | ${'Unknown Date'}
      ${'Infinity'}                                | ${Infinity}      | ${'Unknown Date'}
      ${'-Infinity'}                               | ${-Infinity}     | ${'Unknown Date'}
      ${'a timestamp past the last date there is'} | ${8.64e15 + 1}   | ${'Unknown Date'}
    `('returns $expected for $description', ({ timestamp, expected }) => {
      expect(toISOString(timestamp)).toBe(expected);
    });
  });

  describe('isDaterangeValid', () => {
    it.each`
      startDate                           | endDate                             | expected
      ${undefined}                        | ${undefined}                        | ${false}
      ${null}                             | ${null}                             | ${false}
      ${''}                               | ${''}                               | ${false}
      ${'invalid-date'}                   | ${new Date('2023-01-01').getTime()} | ${false}
      ${new Date('2023-01-01').getTime()} | ${'invalid-date'}                   | ${false}
      ${'invalid-date'}                   | ${'invalid-date'}                   | ${false}
      ${new Date('2023-12-31').getTime()} | ${new Date('2023-01-01').getTime()} | ${false}
      ${new Date('2023-05-15').getTime()} | ${new Date('2023-05-14').getTime()} | ${false}
      ${new Date('2023-01-01').getTime()} | ${new Date('2023-01-01').getTime()} | ${false}
      ${new Date('2023-01-01').getTime()} | ${new Date('2023-12-31').getTime()} | ${true}
      ${new Date('2023-05-14').getTime()} | ${new Date('2023-05-15').getTime()} | ${true}
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
