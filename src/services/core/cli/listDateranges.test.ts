import { beforeEach, describe, expect, it, vi } from 'vitest';

const getStorageMock = vi.fn();

vi.mock('@services/injecter/injecter', () => ({
  inject: { storage: getStorageMock },
}));

describe('listAvailableDateRanges', () => {
  const storage = { getCandleDateranges: vi.fn(), close: vi.fn() };

  beforeEach(() => {
    getStorageMock.mockReturnValue(storage);
    storage.getCandleDateranges.mockReset();
    storage.close.mockReset();
  });

  it.each`
    scenario                               | ranges
    ${'prints fallback when no ranges'}    | ${undefined}
    ${'prints formatted available ranges'} | ${[{ daterange_start: Date.UTC(2017, 7, 17), daterange_end: Date.UTC(2017, 11, 31, 23, 59, 59, 999) }, { daterange_start: Date.UTC(2018, 7, 17), daterange_end: Date.UTC(2018, 11, 31, 23, 59, 59, 999) }]}
  `('$scenario', async ({ ranges }) => {
    storage.getCandleDateranges.mockReturnValue(ranges as never);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const { listAvailableDateRanges } = await import('./listDateranges');
    listAvailableDateRanges();

    if (!ranges || ranges.length === 0) {
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith('No date ranges found.');
    } else {
      const expectedMessages = [
        'Available date ranges:',
        '-> 2017-08-17T00:00:00.000Z - 2017-12-31T23:59:59.999Z',
        '-> 2018-08-17T00:00:00.000Z - 2018-12-31T23:59:59.999Z',
      ];
      expectedMessages.forEach(message => {
        expect(logSpy).toHaveBeenCalledWith(message);
      });
      expect(logSpy).toHaveBeenCalledTimes(expectedMessages.length);
    }

    expect(storage.close).toHaveBeenCalledTimes(1);
    logSpy.mockRestore();
  });
});
