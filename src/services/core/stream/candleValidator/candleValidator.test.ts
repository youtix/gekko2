import { Candle } from '@models/candle.types';
import { CandleEvent } from '@models/event.types';
import { config } from '@services/configuration/configuration';
import * as logger from '@services/logger';
import * as candleUtils from '@utils/candle/candle.utils';
import { describe, expect, it, Mock, vi } from 'vitest';
import { CandleValidatorStream } from './candleValidator.stream';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/configuration/configuration', () => ({ config: { getWatch: vi.fn() } }));
vi.mock('@utils/candle/candle.utils', () => ({ fillMissingCandles: vi.fn() }));

const ONE_MINUTE = 60_000;
const TWO_MINUTES = 120_000;
const NOW = Date.now();

const candle = (start: number): Candle => ({ start, open: 100, close: 100, high: 110, low: 90, volume: 10 });
const candleEvent = (start: number, symbol: `${string}/${string}` = 'BTC/USDT'): CandleEvent => ({
  symbol,
  candle: candle(start),
});

const runStream = async (...candles: Candle[]): Promise<CandleEvent[]> => {
  const stream = new CandleValidatorStream();
  const results: CandleEvent[] = [];
  stream.on('data', (c: CandleEvent) => results.push(c));
  return new Promise((resolve, reject) => {
    stream.on('end', () => resolve(results));
    stream.on('error', reject);
    candles.forEach(c => stream.write(candleEvent(c.start)));
    stream.end();
  });
};

describe('CandleValidatorStream', () => {
  const getWatchMock = config.getWatch as Mock;
  const fillMissingCandlesMock = candleUtils.fillMissingCandles as Mock;
  const warningMock = logger.warning as Mock;

  describe('passthrough (no gaps, no duplicates)', () => {
    it.each`
      mode          | fillGaps
      ${'backtest'} | ${'no'}
      ${'realtime'} | ${'empty'}
      ${'importer'} | ${'no'}
    `('should pass candles through when mode=$mode and fillGaps=$fillGaps', async ({ mode, fillGaps }) => {
      getWatchMock.mockReturnValue({ mode, fillGaps });
      const c1 = candle(NOW - TWO_MINUTES);
      const c2 = candle(NOW - ONE_MINUTE);
      expect(await runStream(c1, c2)).toEqual([candleEvent(c1.start), candleEvent(c2.start)]);
    });
  });

  describe('future candle rejection', () => {
    it('should reject candles ending in the future', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'no' });
      const futureCandle = candle(NOW + ONE_MINUTE);
      expect(await runStream(futureCandle)).toEqual([]);
    });

    it('should log a warning when rejecting a future candle', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'no' });
      await runStream(candle(NOW + ONE_MINUTE));
      expect(warningMock).toHaveBeenCalledWith('stream', expect.stringContaining('Rejecting future candle'));
    });
  });

  describe('duplicate detection', () => {
    it.each`
      scenario                           | c3Start
      ${'same timestamp as previous'}    | ${NOW - ONE_MINUTE}
      ${'older timestamp than previous'} | ${NOW - TWO_MINUTES - ONE_MINUTE}
    `('should ignore candle with $scenario', async ({ c3Start }) => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'no' });
      const c1 = candle(NOW - TWO_MINUTES);
      const c2 = candle(NOW - ONE_MINUTE);
      const c3 = candle(c3Start); // duplicate/older
      expect(await runStream(c1, c2, c3)).toEqual([candleEvent(c1.start), candleEvent(c2.start)]);
    });

    it('should log a warning when ignoring a duplicate candle', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'no' });
      const c1 = candle(NOW - TWO_MINUTES);
      const c2 = candle(NOW - TWO_MINUTES); // duplicate
      await runStream(c1, c2);
      expect(warningMock).toHaveBeenCalledWith('stream', expect.stringContaining('candle already proceed'));
    });
  });

  describe('gap detection', () => {
    const c1 = candle(NOW - 4 * ONE_MINUTE);
    const c4 = candle(NOW - ONE_MINUTE); // gap of 2 candles

    it('should log a warning when a gap is detected', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'no' });
      await runStream(c1, c4);
      expect(warningMock).toHaveBeenCalledWith('stream', expect.stringContaining('Gap detected'));
    });

    it('should not fill gaps when fillGaps is "no"', async () => {
      getWatchMock.mockReturnValue({ mode: 'backtest', fillGaps: 'no' });
      expect(await runStream(c1, c4)).toEqual([candleEvent(c1.start), candleEvent(c4.start)]);
    });

    it('should fill gaps with empty candles when fillGaps is "empty"', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'empty' });
      const c2 = candle(NOW - 3 * ONE_MINUTE);
      const c3 = candle(NOW - 2 * ONE_MINUTE);
      fillMissingCandlesMock.mockReturnValue([c1, c2, c3, c4]);
      expect(await runStream(c1, c4)).toEqual([
        candleEvent(c1.start),
        candleEvent(c2.start),
        candleEvent(c3.start),
        candleEvent(c4.start),
      ]);
    });

    it('should log a warning when filling gaps with empty candles', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'empty' });
      fillMissingCandlesMock.mockReturnValue([c1, candle(NOW - 3 * ONE_MINUTE), c4]);
      await runStream(c1, c4);
      expect(warningMock).toHaveBeenCalledWith('stream', expect.stringContaining('Filling gap using synthetic'));
    });
  });

  describe('configuration', () => {
    it.each`
      mode          | expectedFillGaps
      ${'realtime'} | ${'empty'}
      ${'backtest'} | ${'no'}
    `('should use FILL_GAPS_MODE[$mode] = $expectedFillGaps by default', async ({ mode }) => {
      getWatchMock.mockReturnValue({ mode, fillGaps: 'custom' }); // custom is overridden by mode
      const c1 = candle(NOW - 4 * ONE_MINUTE);
      const c4 = candle(NOW - ONE_MINUTE);
      fillMissingCandlesMock.mockReturnValue([c1, candle(NOW - 3 * ONE_MINUTE), c4]);
      const results = await runStream(c1, c4);
      // In realtime mode, should fill (use 'empty'). In backtest, should not fill (use 'no').
      expect(results.length).toBe(mode === 'realtime' ? 3 : 2);
    });

    it('should fallback to fillGaps config when mode is not in FILL_GAPS_MODE', async () => {
      getWatchMock.mockReturnValue({ mode: 'importer', fillGaps: 'empty' });
      const c1 = candle(NOW - 4 * ONE_MINUTE);
      const c4 = candle(NOW - ONE_MINUTE);
      fillMissingCandlesMock.mockReturnValue([c1, candle(NOW - 3 * ONE_MINUTE), c4]);
      expect(await runStream(c1, c4)).toHaveLength(3);
    });
  });

  describe('error handling', () => {
    it('should propagate errors through the callback', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'empty' });
      fillMissingCandlesMock.mockImplementation(() => {
        throw new Error('Test error');
      });
      const c1 = candle(NOW - 4 * ONE_MINUTE);
      const c4 = candle(NOW - ONE_MINUTE);
      await expect(runStream(c1, c4)).rejects.toThrow('Test error');
    });
  });

  describe('edge cases', () => {
    it('should handle fillMissingCandles returning null or undefined', async () => {
      getWatchMock.mockReturnValue({ mode: 'realtime', fillGaps: 'empty' });
      fillMissingCandlesMock.mockReturnValue(null);
      const c1 = candle(NOW - 4 * ONE_MINUTE);
      const c4 = candle(NOW - ONE_MINUTE);
      expect(await runStream(c1, c4)).toEqual([candleEvent(c1.start), candleEvent(c4.start)]);
    });
  });
});
