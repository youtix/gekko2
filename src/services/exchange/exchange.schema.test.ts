import { describe, expect, it } from 'vitest';
import { exchangeSchema, feeRateSchema, simulationBalanceSchema } from './exchange.schema';

const intervalMessage = (field: string) => `${field} must be an integer number of milliseconds between 1000 and 2147483647`;

describe('exchangeSchema', () => {
  it('polls the portfolio every 10 minutes and the orders every 20 seconds by default', () => {
    expect(exchangeSchema.parse({ name: 'binance' })).toEqual({
      name: 'binance',
      exchangeSynchInterval: 600_000,
      orderSynchInterval: 20_000,
    });
  });

  // Both values are handed to setInterval, which polls every millisecond for a delay of 0, below 0 or above 2^31 - 1.
  describe.each`
    field
    ${'exchangeSynchInterval'}
    ${'orderSynchInterval'}
  `('$field', ({ field }) => {
    it.each`
      scenario                                       | value
      ${'0'}                                         | ${0}
      ${'a negative delay'}                          | ${-1}
      ${'a fractional delay'}                        | ${1.5}
      ${'a delay below one second'}                  | ${999}
      ${'a delay that overflows the timer (3e9 ms)'} | ${3e9}
      ${'2^31 ms, one past the longest timer delay'} | ${2_147_483_648}
      ${'Infinity'}                                  | ${Infinity}
      ${'NaN'}                                       | ${NaN}
      ${'a number given as a string'}                | ${'20000'}
    `('rejects $scenario', ({ value }) => {
      const result = exchangeSchema.safeParse({ name: 'binance', [field]: value });
      expect(result.error?.issues).toMatchObject([{ path: [field], message: intervalMessage(field) }]);
    });

    it.each`
      scenario                      | value
      ${'one second, the shortest'} | ${1000}
      ${'2^31 - 1 ms, the longest'} | ${2_147_483_647}
    `('accepts $scenario', ({ value }) => {
      const result = exchangeSchema.parse({ name: 'binance', [field]: value });
      expect(result[field as 'exchangeSynchInterval' | 'orderSynchInterval']).toBe(value);
    });
  });

  // Dropped, a misspelt interval would leave the default polling period in place
  it('refuses an unknown key instead of dropping it', () => {
    const result = exchangeSchema.safeParse({ name: 'binance', orderSyncInterval: 5000 });
    expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', path: [], keys: ['orderSyncInterval'] }]);
  });
});

describe('simulationBalanceSchema', () => {
  it('refuses an unknown key in an entry instead of dropping it', () => {
    const result = simulationBalanceSchema.safeParse([{ assetName: 'USDT', balance: 1000, locked: 100 }]);
    expect(result.error?.issues).toMatchObject([{ code: 'unrecognized_keys', path: [0], keys: ['locked'] }]);
  });
});

describe('feeRateSchema', () => {
  const feeSchema = feeRateSchema('fee.maker');

  it.each`
    scenario                        | value
    ${'a negative fee'}             | ${-0.1}
    ${'a fee above 100 %'}          | ${1.5}
    ${'NaN'}                        | ${NaN}
    ${'a number given as a string'} | ${'0.001'}
  `('rejects $scenario', ({ value }) => {
    expect(feeSchema.safeParse(value).error?.issues).toMatchObject([
      { message: 'fee.maker must be a fraction between 0 and 1 (0.001 is a 0.1 % fee)' },
    ]);
  });

  it.each`
    scenario            | value
    ${'no fee'}         | ${0}
    ${'a 0.1 % fee'}    | ${0.001}
    ${'a fee of 100 %'} | ${1}
  `('accepts $scenario', ({ value }) => {
    expect(feeSchema.parse(value)).toBe(value);
  });
});
