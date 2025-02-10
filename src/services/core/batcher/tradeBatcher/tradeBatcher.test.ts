import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTrade } from '../../../../models/trade.mock';
import { Trade } from '../../../../models/types/trade.types';
import { logger } from '../../../logger';
import { TradeBatcher } from './tradeBatcher';

vi.mock('../../../logger', () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

describe('TradeBatcher', () => {
  let tradeBatcher: TradeBatcher;

  beforeEach(() => {
    tradeBatcher = new TradeBatcher();
  });

  it('should log and return if batch is empty', () => {
    const result = tradeBatcher.processTrades([]);
    expect(logger.warn).toHaveBeenCalledWith('No new trades !');
    expect(result).toBeUndefined();
  });

  it('should return a new batch event with correct data', () => {
    const batch: Trade[] = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ];

    const result = tradeBatcher.processTrades(batch);

    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Processing 2 new trades.'));
    expect(result).toEqual({
      amount: 2,
      start: batch[0].timestamp,
      end: batch[1].timestamp,
      last: batch[1],
      first: batch[0],
      data: batch,
    });
  });

  it('should update threshold after processing batch', () => {
    const batch: Trade[] = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ];

    tradeBatcher.processTrades(batch);

    expect(tradeBatcher.threshold).toBe(1625259600000);
  });

  it('should only emit once when fed the same trades twice', () => {
    const batch: Trade[] = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ];

    tradeBatcher.processTrades(batch);
    const result = tradeBatcher.processTrades(batch);

    expect(result).toBeUndefined();
  });

  /** remove trades that have zero amount see @link https://github.com/askmike/gekko/issues/486 */
  it('should filter out empty trades', () => {
    const batch: Trade[] = [
      generateTrade({ amount: 0, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ];

    const result = tradeBatcher.processTrades(batch);

    expect(result).toEqual(
      expect.objectContaining({
        amount: 1,
        last: batch[1],
        first: batch[1],
      }),
    );
  });

  it('should filter already known trades', () => {
    const batch1: Trade[] = [generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 })];
    const batch2: Trade[] = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ];

    tradeBatcher.processTrades(batch1);
    const result = tradeBatcher.processTrades(batch2);

    expect(result).toEqual(
      expect.objectContaining({
        amount: 1,
        last: batch2[1],
        first: batch2[1],
      }),
    );
  });
});
