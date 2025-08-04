import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateTrade } from '../../../../models/trade.mock';
import { Trade } from '../../../../models/types/trade.types';
import { toTimestamp } from '../../../../utils/date/date.utils';
import { debug, warning } from '../../../logger';
import { TradeBatcher } from './tradeBatcher';

vi.mock('@services/logger', () => ({ debug: vi.fn(), warning: vi.fn() }));
vi.mock('@utils/process/process.utils', () => ({ processStartTime: vi.fn(() => toTimestamp('2025')) }));

describe('TradeBatcher', () => {
  let tradeBatcher: TradeBatcher;

  beforeEach(() => {
    tradeBatcher = new TradeBatcher();
  });

  it('should log and return if batch is empty', () => {
    const result = tradeBatcher.processTrades([]);
    expect(warning).toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('should return a new batch event with correct data', () => {
    const batch = [
      generateTrade({ amount: 10, timestamp: toTimestamp('2025'), price: 1000 }),
      generateTrade({ amount: 15, timestamp: toTimestamp('2025-01-01T00:00:01.000Z'), price: 1000 }),
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

  it('should update lastTrades after processing batch', () => {
    const batch = [
      generateTrade({ amount: 10, timestamp: toTimestamp('2025'), price: 1000 }),
      generateTrade({ amount: 15, timestamp: toTimestamp('2025-01-01T00:00:01.000Z'), price: 1000 }),
    ] as Trade[];

    expect(tradeBatcher['lastTrades']).toEqual([]);
    tradeBatcher.processTrades(batch);
    expect(tradeBatcher['lastTrades']).toEqual(batch);
  });

  it('should only emit once when fed the same trades twice', () => {
    const batch = [
      generateTrade({ amount: 10, timestamp: toTimestamp('2025'), price: 1000 }),
      generateTrade({ amount: 15, timestamp: toTimestamp('2025-01-01T00:00:01.000Z'), price: 1000 }),
    ] as Trade[];

    tradeBatcher.processTrades(batch);
    const result = tradeBatcher.processTrades(batch);

    expect(result).toBeUndefined();
  });

  it('should filter already known trades', () => {
    const batch1 = [
      generateTrade({ id: '1', timestamp: toTimestamp('2025') }),
      generateTrade({ id: '2', timestamp: toTimestamp('2025') }),
      generateTrade({ id: '3', timestamp: toTimestamp('2025') }),
    ] as Trade[];
    const batch2 = [
      generateTrade({ id: '2', timestamp: toTimestamp('2025') }),
      generateTrade({ id: '3', timestamp: toTimestamp('2025') }),
      generateTrade({ id: '4', timestamp: toTimestamp('2025') }),
    ] as Trade[];

    tradeBatcher.processTrades(batch1);
    const result = tradeBatcher.processTrades(batch2);

    expect(result).toEqual(
      expect.objectContaining({
        amount: 1,
        last: batch2[2],
        first: batch2[2],
      }),
    );
  });
});
