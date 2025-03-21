import { describe, expect, it } from 'vitest';
import { MACD } from './macd.indicator';

describe('MACD', () => {
  const macd = new MACD({ short: 12, long: 26, signal: 9 });

  it.each`
    candle           | result
    ${{ close: 81 }} | ${0}
    ${{ close: 24 }} | ${-3.637606837606832}
    ${{ close: 75 }} | ${-2.4639072734799217}
    ${{ close: 21 }} | ${-5.0313402956200255}
    ${{ close: 34 }} | ${-5.521802745494812}
    ${{ close: 25 }} | ${-6.07615272479279}
    ${{ close: 72 }} | ${-3.053848272963075}
    ${{ close: 92 }} | ${0.335683106367476}
    ${{ close: 99 }} | ${2.947305654317421}
    ${{ close: 2 }}  | ${-1.709310094910599}
    ${{ close: 86 }} | ${0.877483707093785}
    ${{ close: 80 }} | ${2.123112575618308}
    ${{ close: 76 }} | ${2.585623647541943}
    ${{ close: 8 }}  | ${-1.557177582225662}
    ${{ close: 87 }} | ${1.015418847042154}
    ${{ close: 75 }} | ${1.852514921927151}
    ${{ close: 32 }} | ${-0.424618797146959}
    ${{ close: 65 }} | ${0.316789936193977}
    ${{ close: 41 }} | ${-0.727032137049482}
    ${{ close: 9 }}  | ${-3.3439676735158574}
    ${{ close: 13 }} | ${-4.504658691176681}
    ${{ close: 26 }} | ${-4.107132512783026}
    ${{ close: 56 }} | ${-1.659523692053837}
    ${{ close: 28 }} | ${-1.752912597917129}
    ${{ close: 65 }} | ${0.718089339797561}
    ${{ close: 58 }} | ${1.857253894211317}
    ${{ close: 17 }} | ${-0.072101936682018}
    ${{ close: 90 }} | ${3.451771132909606}
    ${{ close: 87 }} | ${5.350885446717408}
    ${{ close: 86 }} | ${6.24751731606972}
    ${{ close: 99 }} | ${7.348017624085435}
    ${{ close: 3 }}  | ${1.5457357005888632}
    ${{ close: 70 }} | ${2.1198449676882114}
    ${{ close: 1 }}  | ${-2.023576889308403}
    ${{ close: 27 }} | ${-2.8393606369629105}
    ${{ close: 9 }}  | ${-4.328186283416068}
    ${{ close: 92 }} | ${0.2946340051329645}
    ${{ close: 68 }} | ${1.6766181261237925}
    ${{ close: 9 }}  | ${-1.282576553996294}
  `('should correctly calculate MACD results with 12/26/9 when adding $candle candle', ({ candle, result }) => {
    macd.onNewCandle(candle);
    expect(macd.getResult()).toBe(result);
  });
});

//
