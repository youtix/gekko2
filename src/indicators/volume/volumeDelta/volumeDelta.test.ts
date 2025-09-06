import { describe, expect, it } from 'vitest';
import { MACD } from '../../momentum/macd/macd.indicator';
import { VolumeDelta } from './volumeDelta.indicator';

const closeOrNull = (a: number | null, b: number | null, precision = 10) => {
  if (a === null || b === null) {
    expect(a).toBe(b);
  } else {
    expect(a).toBeCloseTo(b, precision);
  }
};

describe('VolumeDelta', () => {
  it.each`
    src | candles
    ${'quote'} | ${[
  // quoteVolume / quoteVolumeActive drive volumeDelta; base volume fields are noise for this test
  { open: 1, high: 2, low: 1, close: 1, volume: 999, volumeActive: 1, quoteVolume: 100, quoteVolumeActive: 60 }, // 20
  { open: 2, high: 3, low: 1, close: 2, volume: 1, volumeActive: 1, quoteVolume: 200, quoteVolumeActive: 50 }, // -100
  { open: 3, high: 4, low: 2, close: 3, volume: 2, volumeActive: 2, quoteVolume: 150, quoteVolumeActive: 120 }, // 90
  { open: 4, high: 5, low: 3, close: 4, volume: 3, volumeActive: 3, quoteVolume: 0, quoteVolumeActive: 0 }, // 0
  { open: 5, high: 6, low: 4, close: 5, volume: 4, volumeActive: 4, quoteVolume: 300, quoteVolumeActive: 160 }, // 20
  { open: 6, high: 7, low: 5, close: 6, volume: 5, volumeActive: 5, quoteVolume: 80, quoteVolumeActive: 30 }, // -20
  { open: 7, high: 8, low: 6, close: 7, volume: 6, volumeActive: 6, quoteVolume: 50, quoteVolumeActive: 40 }, // 30
  { open: 8, high: 9, low: 7, close: 8, volume: 7, volumeActive: 7, quoteVolume: 500, quoteVolumeActive: 250 }, // 0
  { open: 9, high: 10, low: 8, close: 9, volume: 8, volumeActive: 8, quoteVolume: 400, quoteVolumeActive: 340 }, // 280
  { open: 10, high: 11, low: 9, close: 10, volume: 9, volumeActive: 9, quoteVolume: 100, quoteVolumeActive: 10 }, // -80
  { open: 11, high: 12, low: 10, close: 11, volume: 10, volumeActive: 10, quoteVolume: 1000, quoteVolumeActive: 900 }, // 800
  { open: 12, high: 13, low: 11, close: 12, volume: 11, volumeActive: 11, quoteVolume: 10, quoteVolumeActive: 9 }, // 8
]}
    ${'base'} | ${[
  // base volume fields are the signal; quote fields are noise for this test
  { open: 1, high: 2, low: 1, close: 1, volume: 10, volumeActive: 6, quoteVolume: 1, quoteVolumeActive: 1 }, // 2
  { open: 2, high: 3, low: 1, close: 2, volume: 50, volumeActive: 10, quoteVolume: 2, quoteVolumeActive: 2 }, // -30
  { open: 3, high: 4, low: 2, close: 3, volume: 30, volumeActive: 25, quoteVolume: 3, quoteVolumeActive: 3 }, // 20
  { open: 4, high: 5, low: 3, close: 4, volume: 0, volumeActive: 0, quoteVolume: 4, quoteVolumeActive: 4 }, // 0
  { open: 5, high: 6, low: 4, close: 5, volume: 7, volumeActive: 3, quoteVolume: 5, quoteVolumeActive: 5 }, // -1
  { open: 6, high: 7, low: 5, close: 6, volume: 100, volumeActive: 80, quoteVolume: 6, quoteVolumeActive: 6 }, // 60
  { open: 7, high: 8, low: 6, close: 7, volume: 200, volumeActive: 40, quoteVolume: 7, quoteVolumeActive: 7 }, // -120
  { open: 8, high: 9, low: 7, close: 8, volume: 40, volumeActive: 39, quoteVolume: 8, quoteVolumeActive: 8 }, // 38
  { open: 9, high: 10, low: 8, close: 9, volume: 5, volumeActive: 1, quoteVolume: 9, quoteVolumeActive: 9 }, // -3
  { open: 10, high: 11, low: 9, close: 10, volume: 60, volumeActive: 40, quoteVolume: 10, quoteVolumeActive: 10 }, // 20
]}
  `('computes $src-based volume delta and aligns with MACD', ({ src, candles }) => {
    // Use small periods to warm up MACD quickly and keep tests fast.
    const params = { short: 3, long: 5, signal: 3 } as const;
    const vd = new VolumeDelta({ src, ...params });
    const macd = new MACD({ ...params });

    for (const candle of candles) {
      const total = (src === 'quote' ? candle.quoteVolume : candle.volume) ?? 0;
      const active = (src === 'quote' ? candle.quoteVolumeActive : candle.volumeActive) ?? 0;
      const expectedDelta = active - (total - active);

      vd.onNewCandle(candle as any);
      const res = vd.getResult();
      expect(res?.volumeDelta).toBeCloseTo(expectedDelta, 10);

      macd.onNewCandle({ close: expectedDelta } as any);
      const exp = macd.getResult();

      closeOrNull(res?.macd ?? null, exp.macd);
      closeOrNull(res?.signal ?? null, exp.signal);
      closeOrNull(res?.hist ?? null, exp.hist);
    }
  });

  it.each`
    src
    ${'quote'}
    ${'base'}
  `('defaults missing fields to zero ($src)', ({ src }) => {
    const params = { short: 3, long: 5, signal: 3 } as const;
    const vd = new VolumeDelta({ src, ...params });
    const macd = new MACD({ ...params });

    const candles = [
      { open: 1, high: 1, low: 1, close: 1, volume: 0 },
      { open: 2, high: 2, low: 2, close: 2, volume: 0 },
      { open: 3, high: 3, low: 3, close: 3, volume: 0 },
    ];

    for (const candle of candles) {
      vd.onNewCandle(candle as any);
      const r = vd.getResult();
      expect(r?.volumeDelta).toBeCloseTo(0, 10);
      macd.onNewCandle({ close: 0 } as any);
      const e = macd.getResult();
      closeOrNull(r?.macd ?? null, e.macd);
      closeOrNull(r?.signal ?? null, e.signal);
      closeOrNull(r?.hist ?? null, e.hist);
    }
  });
});
