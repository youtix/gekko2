import { EMPTY_ORDER_SUMMARY } from '@constants/order.const';
import { GekkoError } from '@errors/gekko.error';
import { Trade } from '@models/trade.types';
import { Exchange } from '@services/exchange/exchange.types';
import { debug } from '@services/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Transaction } from './order.types';
import { createOrderSummary, toError } from './order.utils';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));

const fetchMyTrades = vi.fn();
const exchange = { fetchMyTrades } as unknown as Exchange;

const transaction = (id: string, timestamp: EpochTimeStamp): Transaction => ({ id, timestamp, filled: 1, status: 'closed' });
const trade = (id: string, amount: number, price: number, timestamp: EpochTimeStamp, fee?: Trade['fee']) =>
  ({ id, amount, price, timestamp, fee }) as Trade;

const summarize = (transactions: Transaction[]) =>
  createOrderSummary({
    id: 'ee21e130-48bc-405f-be0c-46e9bf17b52e',
    symbol: 'BTC/USDT',
    exchange,
    type: 'STICKY',
    side: 'BUY',
    transactions,
  });

describe('toError', () => {
  it('returns an Error as it is', () => {
    const err = new Error('boom');
    expect(toError(err)).toBe(err);
  });

  it.each`
    value        | message
    ${'boom'}    | ${'boom'}
    ${42}        | ${'42'}
    ${undefined} | ${'undefined'}
  `('wraps $value in an Error with the message "$message"', ({ value, message }) => {
    expect(toError(value)).toEqual(new Error(message));
  });
});

describe('createOrderSummary', () => {
  beforeEach(() => {
    fetchMyTrades.mockResolvedValue([]);
  });

  it('throws a GekkoError when the order has no transaction', async () => {
    await expect(summarize([])).rejects.toThrow(GekkoError);
  });

  // A sticky order places several exchange orders, and an exchange may give an order without a timestamp
  it.each`
    case                                        | timestamps                                     | from
    ${'the oldest transaction comes first'}     | ${[1_000_700, 2_000_500]}                      | ${1_000_000}
    ${'the transactions are not sorted'}        | ${[3_000_000, 2_000_500, 1_000_700]}           | ${1_000_000}
    ${'some timestamps are not finite numbers'} | ${[NaN, 5_000_300, undefined, Infinity, null]} | ${5_000_000}
    ${'no timestamp is a finite number'}        | ${[NaN, undefined, -Infinity]}                 | ${undefined}
  `('fetches the trades from the start of the second of the oldest finite timestamp when $case', async ({ timestamps, from }) => {
    await summarize(timestamps.map((timestamp: EpochTimeStamp, index: number) => transaction(`ex-${index}`, timestamp)));
    expect(fetchMyTrades).toHaveBeenCalledWith('BTC/USDT', from);
  });

  it('logs an unknown start for the trades fetched when no timestamp is a finite number', async () => {
    await summarize([transaction('ex-0', NaN)]);
    expect(debug).toHaveBeenCalledWith('core', expect.stringContaining('First trade started at: Unknown Date.'));
  });

  it('returns the empty summary of its side when no trade belongs to the order', async () => {
    fetchMyTrades.mockResolvedValue([trade('another-order', 1, 100, 1_100_000, { rate: 0.1 })]);
    expect(await summarize([transaction('ex-0', 1_000_000)])).toEqual({ ...EMPTY_ORDER_SUMMARY, side: 'BUY' });
  });

  it('summarizes the trades of the order, in the order they were made', async () => {
    fetchMyTrades.mockResolvedValue([
      trade('ex-1', 3, 110, 2_500_000, { rate: 0.5 }),
      trade('another-order', 10, 90, 1_200_000, { rate: 0.1 }),
      trade('ex-0', 1, 100, 1_100_000, { rate: 0.1 }),
    ]);
    const summary = await summarize([transaction('ex-1', 2_000_000), transaction('ex-0', 1_000_000)]);
    expect(summary).toEqual({ amount: 4, price: 107.5, feePercent: 0.4, side: 'BUY', orderExecutionDate: 2_500_000 });
  });

  // Only the trades with a known rate weigh in, each by its own amount: 1 for the first trade, 3 for the second
  it.each`
    case                               | fees                                                 | feePercent
    ${'every trade has a rate'}        | ${[{ rate: 0.1 }, { rate: 0.5 }]}                    | ${0.4}
    ${'a trade was made without fees'} | ${[{ rate: 0 }, { rate: 0.5 }]}                      | ${0.375}
    ${'a trade has no rate'}           | ${[{ cost: 0.001, currency: 'BNB' }, { rate: 0.5 }]} | ${0.5}
    ${'a rate is not a finite number'} | ${[{ rate: NaN }, { rate: 0.5 }]}                    | ${0.5}
    ${'a rate is null'}                | ${[{ rate: null }, { rate: 0.5 }]}                   | ${0.5}
    ${'a trade has no fee'}            | ${[undefined, { rate: 0.5 }]}                        | ${0.5}
    ${'no trade has a rate'}           | ${[{ cost: 0.001, currency: 'BNB' }, { rate: NaN }]} | ${undefined}
    ${'no trade has a fee'}            | ${[undefined, undefined]}                            | ${undefined}
  `('gives a fee percent of $feePercent when $case', async ({ fees, feePercent }) => {
    fetchMyTrades.mockResolvedValue([trade('ex-0', 1, 100, 1_100_000, fees[0]), trade('ex-1', 3, 110, 2_500_000, fees[1])]);
    const summary = await summarize([transaction('ex-0', 1_000_000), transaction('ex-1', 2_000_000)]);
    expect(summary.feePercent).toBe(feePercent);
  });

  it('gives no fee percent when the trades with a rate weigh nothing', async () => {
    fetchMyTrades.mockResolvedValue([trade('ex-0', 0, 100, 1_100_000, { rate: 0.1 }), trade('ex-1', 3, 110, 2_500_000, {})]);
    const summary = await summarize([transaction('ex-0', 1_000_000), transaction('ex-1', 2_000_000)]);
    expect(summary.feePercent).toBeUndefined();
  });
});
