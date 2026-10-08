import { Candle } from '@models/candle.types';
import { describe, expect, it } from 'vitest';
import * as indicators from './index';
import { Indicator } from './indicator';

const price = (index: number) => 100 + 10 * Math.sin(index / 3) + 5 * Math.sin(index / 7);
// A zigzag without a flat window, so no indicator waits on a zero range or a zero middle band
const candles: Candle[] = Array.from({ length: 150 }, (_, index) => {
  const open = price(index - 1);
  const close = price(index);
  return {
    start: index * 60_000,
    open,
    high: Math.max(open, close) + 1,
    low: Math.min(open, close) - 1,
    close,
    volume: 100 + ((index * 37) % 50),
  };
});

/** A complete result is a number, or an object whose fields are all numbers (arrays of numbers for the ribbons) */
const readiness = (result: unknown) => {
  if (result === null) return 'null';
  const values = typeof result === 'number' ? [result] : Object.values(result as object).flat();
  return values.every(Number.isFinite) ? 'complete' : 'partial';
};

describe('Indicator', () => {
  it.each`
    name                 | parameters                                                                 | firstComplete
    ${'ADX'}             | ${{ period: 14 }}                                                          | ${28}
    ${'ADXRibbon'}       | ${{}}                                                                      | ${132}
    ${'DX'}              | ${{ period: 14 }}                                                          | ${15}
    ${'MinusDI'}         | ${{ period: 14 }}                                                          | ${15}
    ${'MinusDM'}         | ${{ period: 14 }}                                                          | ${14}
    ${'PlusDI'}          | ${{ period: 14 }}                                                          | ${15}
    ${'PlusDM'}          | ${{ period: 14 }}                                                          | ${14}
    ${'MACD'}            | ${{}}                                                                      | ${34}
    ${'PSAR'}            | ${{}}                                                                      | ${2}
    ${'ROC'}             | ${{ period: 10 }}                                                          | ${10}
    ${'Stochastic'}      | ${{}}                                                                      | ${9}
    ${'Stochastic'}      | ${{ fastKPeriod: 1, slowKPeriod: 3, slowKMaType: 'dema', slowDPeriod: 1 }} | ${5}
    ${'Stochastic'}      | ${{ fastKPeriod: 1, slowKPeriod: 1, slowDPeriod: 3, slowDMaType: 'dema' }} | ${5}
    ${'StochasticRSI'}   | ${{}}                                                                      | ${21}
    ${'StochasticRSI'}   | ${{ fastKPeriod: 2, fastDPeriod: 5, slowMaType: 'dema' }}                  | ${23}
    ${'TRIX'}            | ${{}}                                                                      | ${88}
    ${'WilliamsR'}       | ${{}}                                                                      | ${14}
    ${'DEMA'}            | ${{ period: 10 }}                                                          | ${19}
    ${'EMA'}             | ${{}}                                                                      | ${30}
    ${'EMARibbon'}       | ${{}}                                                                      | ${66}
    ${'SMA'}             | ${{}}                                                                      | ${30}
    ${'SMMA'}            | ${{ period: 14 }}                                                          | ${14}
    ${'TEMA'}            | ${{ period: 10 }}                                                          | ${28}
    ${'WilderSmoothing'} | ${{}}                                                                      | ${14}
    ${'WMA'}             | ${{ period: 10 }}                                                          | ${10}
    ${'AO'}              | ${{}}                                                                      | ${34}
    ${'CCI'}             | ${{}}                                                                      | ${14}
    ${'RSI'}             | ${{}}                                                                      | ${15}
    ${'ATR'}             | ${{ period: 14 }}                                                          | ${15}
    ${'ATRCD'}           | ${{}}                                                                      | ${35}
    ${'BollingerBands'}  | ${{}}                                                                      | ${5}
    ${'BollingerBands'}  | ${{ maType: 'dema' }}                                                      | ${9}
    ${'TrueRange'}       | ${undefined}                                                               | ${2}
    ${'EFI'}             | ${{}}                                                                      | ${14}
    ${'EFI'}             | ${{ maType: 'dema' }}                                                      | ${26}
    ${'OBV'}             | ${{}}                                                                      | ${15}
    ${'OBV'}             | ${{ maType: 'dema' }}                                                      | ${28}
  `(
    'should return null until candle $firstComplete, then only complete results, for $name $parameters',
    ({ name, parameters, firstComplete }) => {
      const IndicatorClass = indicators[name as keyof typeof indicators] as unknown as new (parameters?: object) => Indicator;
      const indicator = new IndicatorClass(parameters);
      const results = [
        indicator.getResult(),
        ...candles.map(candle => {
          indicator.onNewCandle(candle);
          return indicator.getResult();
        }),
      ];
      expect(results.map(readiness)).toEqual(results.map((_, candleCount) => (candleCount < firstComplete ? 'null' : 'complete')));
    },
  );
});
