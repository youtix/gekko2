import { describe, expect, it } from 'vitest';
import { WilderSmoothing } from './wilderSmoothing.indicator';

describe('WilderSmoothing', () => {
  const ws = new WilderSmoothing({ period: 5 });
  it.each`
    candle                | expected
    ${{ close: 62.125 }}  | ${null}
    ${{ close: 61.125 }}  | ${null}
    ${{ close: 62.3438 }} | ${null}
    ${{ close: 65.3125 }} | ${null}
    ${{ close: 63.9688 }} | ${62.97502}
    ${{ close: 63.4375 }} | ${63.067516}
    ${{ close: 63 }}      | ${63.0540128}
    ${{ close: 63.7812 }} | ${63.19945024}
    ${{ close: 63.4062 }} | ${63.240800192}
    ${{ close: 63.4062 }} | ${63.2738801536}
    ${{ close: 62.4375 }} | ${63.10660412288}
    ${{ close: 61.8438 }} | ${62.854043298304}
  `('should correctly calculate Wilder Smoothing when candle is $candle', ({ candle, expected }) => {
    ws.onNewCandle(candle);
    expect(ws.getResult()).toBe(expected);
  });
});
