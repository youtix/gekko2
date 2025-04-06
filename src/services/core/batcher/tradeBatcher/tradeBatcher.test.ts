import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTrade } from '../../../../models/trade.mock';
import { Trade } from '../../../../models/types/trade.types';
import { debug, warning } from '../../../logger';
import { TradeBatcher } from './tradeBatcher';

vi.mock('@services/logger', () => ({ debug: vi.fn(), warning: vi.fn() }));

describe('TradeBatcher', () => {
  let tradeBatcher: TradeBatcher;

  beforeEach(() => {
    tradeBatcher = new TradeBatcher();
  });

  it('should log and return if batch is empty', () => {
    const result = tradeBatcher.processTrades([]);
    expect(warning).toHaveBeenCalledWith('core', 'No new trades !');
    expect(result).toBeUndefined();
  });

  it('should return a new batch event with correct data', () => {
    const batch = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ] as Trade[];

    const result = tradeBatcher.processTrades(batch);

    expect(debug).toHaveBeenCalledWith('core', expect.stringContaining('Processing 2 new trades.'));
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
    const batch = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ] as Trade[];

    tradeBatcher.processTrades(batch);

    expect(tradeBatcher.threshold).toBe(1625259600000);
  });

  it('should only emit once when fed the same trades twice', () => {
    const batch = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ] as Trade[];

    tradeBatcher.processTrades(batch);
    const result = tradeBatcher.processTrades(batch);

    expect(result).toBeUndefined();
  });

  /** remove trades that have zero amount see @link https://github.com/askmike/gekko/issues/486 */
  it('should filter out empty trades', () => {
    const batch = [
      generateTrade({ amount: 0, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ] as Trade[];

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
    const batch1 = [generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 })] as Trade[];
    const batch2 = [
      generateTrade({ amount: 10, timestamp: 1625256000000, price: 1000 }),
      generateTrade({ amount: 15, timestamp: 1625259600000, price: 1000 }),
    ] as Trade[];

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
