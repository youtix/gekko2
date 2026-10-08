import { Candle } from '@models/candle.types';
import { InputSources } from '@models/inputSources.types';
import { describe, expect, it } from 'vitest';
import * as indicators from './index';
import { Indicator } from './indicator';
import { INPUT_SOURCES } from './indicator.const';

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
    ${'ROC'}             | ${{ period: 10 }}                                                          | ${11}
    ${'ROC'}             | ${{ period: 1 }}                                                           | ${2}
    ${'Stochastic'}      | ${{}}                                                                      | ${9}
    ${'Stochastic'}      | ${{ fastKPeriod: 1, slowKPeriod: 3, slowKMaType: 'dema', slowDPeriod: 1 }} | ${5}
    ${'Stochastic'}      | ${{ fastKPeriod: 1, slowKPeriod: 1, slowDPeriod: 3, slowDMaType: 'dema' }} | ${5}
    ${'StochasticRSI'}   | ${{}}                                                                      | ${21}
    ${'StochasticRSI'}   | ${{ fastKPeriod: 2, fastDPeriod: 5, slowMaType: 'dema' }}                  | ${23}
    ${'TRIX'}            | ${{}}                                                                      | ${89}
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
    ${'EFI'}             | ${{ maType: 'sma', src: 'hl2' }}                                           | ${14}
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

  // src names the price an indicator reads in place of the close. DEMA, TEMA, WMA, SMMA and Wilder's smoothing used to ignore it, and
  // EFI took the close for its force whatever src said, then smoothed NaN with an sma or an ema
  it.each`
    name                 | parameters                          | src
    ${'SMA'}             | ${{ period: 5 }}                    | ${'open'}
    ${'EMA'}             | ${{ period: 5 }}                    | ${'hl2'}
    ${'DEMA'}            | ${{ period: 5 }}                    | ${'hlc3'}
    ${'TEMA'}            | ${{ period: 5 }}                    | ${'ohlc4'}
    ${'WMA'}             | ${{ period: 5 }}                    | ${'high'}
    ${'SMMA'}            | ${{ period: 5 }}                    | ${'low'}
    ${'WilderSmoothing'} | ${{ period: 5 }}                    | ${'open'}
    ${'EMARibbon'}       | ${{ count: 3, start: 2, step: 2 }}  | ${'hl2'}
    ${'RSI'}             | ${{ period: 5 }}                    | ${'hlc3'}
    ${'MACD'}            | ${{ short: 3, long: 6, signal: 3 }} | ${'ohlc4'}
    ${'EFI'}             | ${{ period: 5, maType: 'sma' }}     | ${'hl2'}
    ${'EFI'}             | ${{ period: 5, maType: 'ema' }}     | ${'high'}
    ${'EFI'}             | ${{ period: 5, maType: 'dema' }}    | ${'open'}
    ${'EFI'}             | ${{ period: 5, maType: 'wma' }}     | ${'low'}
  `('should read the $src price as it reads the close, for $name $parameters', ({ name, parameters, src }) => {
    const IndicatorClass = indicators[name as keyof typeof indicators] as unknown as new (parameters?: object) => Indicator;
    const results = (indicator: Indicator, series: Candle[]) =>
      series.map(candle => {
        indicator.onNewCandle(candle);
        return structuredClone(indicator.getResult());
      });
    const priceAsClose = candles.map(candle => ({ ...candle, close: INPUT_SOURCES[src as InputSources](candle) }));
    expect(results(new IndicatorClass({ ...parameters, src }), candles)).toEqual(results(new IndicatorClass(parameters), priceAsClose));
  });
});
