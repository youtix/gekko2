import { Trade } from '@models/types/trade.types';
import { beforeEach, describe, expect, it } from 'vitest';
import { TradeBatcher } from './tradeBatcher';
const now = Date.now();
const mkTrade = (id: string, offsetMs = 0): Trade => ({
  id,
  timestamp: now + offsetMs,
  price: 10_000 + Number(id),
  amount: 1,
  fee: { rate: 0 },
});

describe('TradeBatcher', () => {
  let batcher: TradeBatcher;

  beforeEach(() => {
    batcher = new TradeBatcher();
  });

  it('should produce a batch containing all fresh trades', () => {
    const trades = [mkTrade('1'), mkTrade('2', 1_000), mkTrade('3', 2_000)];
    const batch = batcher.processTrades(trades);
    expect(batch?.amount).toBe(3);
  });

  it('should return undefined when only duplicate trades are processed', () => {
    const trades = [mkTrade('4'), mkTrade('5', 1_000)];
    batcher.processTrades(trades); // initial call
    const result = batcher.processTrades(trades); // duplicates
    expect(result).toBeUndefined();
  });

  it('should ignore trades older than the process start date', () => {
    const oldTrade: Trade = {
      id: '6',
      timestamp: now - 3_600_000, // 1 h in the past
      price: 9_000,
      amount: 1,
      fee: { rate: 0 },
    };
    const result = batcher.processTrades([oldTrade]);
    expect(result).toBeUndefined();
  });

  it('should accept new trades after the previous batch', () => {
    batcher.processTrades([mkTrade('7'), mkTrade('8')]);
    const laterTrades = [mkTrade('9', 3_000), mkTrade('10', 5_000)];
    const batch = batcher.processTrades(laterTrades);
    expect(batch?.amount).toBe(2);
  });
});
