import { describe, expect, it } from 'vitest';
import { paperBinanceExchangeSchema } from './paperTradingBinanceExchange.schema';

const createConfig = (feeOverride?: Record<string, unknown>) => ({
  name: 'paper-binance',
  simulationBalance: [{ assetName: 'USDT', balance: 1000 }],
  ...(feeOverride && { feeOverride }),
});

const feeMessage = (field: string) => `${field} must be a fraction between 0 and 1 (0.001 is a 0.1 % fee)`;

describe('paperBinanceExchangeSchema', () => {
  it('keeps the Binance fees when the configuration overrides none', () => {
    expect(paperBinanceExchangeSchema.parse(createConfig()).feeOverride).toBeUndefined();
  });

  it.each`
    scenario                       | feeOverride
    ${'no fee and a fee of 100 %'} | ${{ maker: 0, taker: 1 }}
    ${'the maker fee alone'}       | ${{ maker: 0.001 }}
    ${'the taker fee alone'}       | ${{ taker: 0.002 }}
    ${'an empty override'}         | ${{}}
  `('accepts $scenario', ({ feeOverride }) => {
    expect(paperBinanceExchangeSchema.parse(createConfig(feeOverride)).feeOverride).toEqual(feeOverride);
  });

  it.each`
    scenario                         | feeOverride           | path                        | message
    ${'a negative maker fee'}        | ${{ maker: -0.5 }}    | ${['feeOverride', 'maker']} | ${feeMessage('feeOverride.maker')}
    ${'a maker fee above 100 %'}     | ${{ maker: 1.5 }}     | ${['feeOverride', 'maker']} | ${feeMessage('feeOverride.maker')}
    ${'a negative taker fee'}        | ${{ taker: -0.1 }}    | ${['feeOverride', 'taker']} | ${feeMessage('feeOverride.taker')}
    ${'a taker fee above 100 %'}     | ${{ taker: 1.5 }}     | ${['feeOverride', 'taker']} | ${feeMessage('feeOverride.taker')}
    ${'a taker fee given as a text'} | ${{ taker: '0.002' }} | ${['feeOverride', 'taker']} | ${feeMessage('feeOverride.taker')}
  `('rejects $scenario', ({ feeOverride, path, message }) => {
    const result = paperBinanceExchangeSchema.safeParse(createConfig(feeOverride));
    expect(result.error?.issues).toMatchObject([{ path, message }]);
  });

  it('keeps the sync interval bounds shared by every exchange', () => {
    const result = paperBinanceExchangeSchema.safeParse({ ...createConfig(), exchangeSynchInterval: 0 });
    expect(result.error?.issues).toMatchObject([{ path: ['exchangeSynchInterval'] }]);
  });
});
