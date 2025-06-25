import { STARTEGY_ADVICE_EVENT } from '@plugins/plugin.const';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Advice } from '../../models/types/advice.types';
import { Candle } from '../../models/types/candle.types';
import { DEMA } from './dema.strategy';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn();
  Configuration.prototype.getStrategy = vi.fn(() => ({
    period: 14,
    thresholds: { up: 0.5, down: -0.5 },
  }));
  return { config: new Configuration() };
});

describe('DEMA Strategy', () => {
  let strategy: DEMA;
  let dema: any;
  let sma: any;
  let advices: string[];
  let candle: Candle;

  beforeEach(() => {
    strategy = new DEMA('DEMA', 60, 0);

    dema = { onNewCandle: vi.fn(), getResult: vi.fn() };
    sma = { onNewCandle: vi.fn(), getResult: vi.fn() };
    strategy['indicators'] = [dema, sma];

    advices = [];
    strategy['on'](STARTEGY_ADVICE_EVENT, (advice: Advice) => advices.push(advice.recommendation));

    candle = { start: Date.now(), open: 1, high: 2, low: 0, close: 1, volume: 100 };
    // Bypass warmup if using onNewCandle directly
    strategy['isWarmupCompleted'] = true;
    strategy['candle'] = candle;
  });

  describe('onTradeExecuted', () => {
    it('should not emit advice ', () => {
      dema.getResult.mockReturnValue(1);
      sma.getResult.mockReturnValue(2);

      strategy['onTradeExecuted']();

      expect(advices).toHaveLength(0);
    });
  });
  describe('onEachCandle', () => {
    it('should not emit advice', () => {
      dema.getResult.mockReturnValue(1);
      sma.getResult.mockReturnValue(2);

      strategy['onEachCandle']();

      expect(advices).toHaveLength(0);
    });
  });
  describe('end', () => {
    it('should not emit advice', () => {
      dema.getResult.mockReturnValue(1);
      sma.getResult.mockReturnValue(2);

      strategy['end']();

      expect(advices).toHaveLength(0);
    });
  });

  it('should not emit advice when results are not numbers', () => {
    dema.getResult.mockReturnValue(undefined);
    sma.getResult.mockReturnValue(undefined);

    strategy['onCandleAfterWarmup'](candle);

    expect(advices).toHaveLength(0);
  });

  it('should emits long advice when SMA - DEMA > up threshold', () => {
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(2); // diff = 2 - 1 = 1 > 0.5

    strategy['onCandleAfterWarmup'](candle);

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('long');
  });

  it('should not re-advise on continued uptrend', () => {
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(2);

    strategy['onCandleAfterWarmup'](candle); // first long
    strategy['onCandleAfterWarmup'](candle); // still uptrend

    expect(advices).toHaveLength(1);
  });

  it('should emits short advice when SMA - DEMA < down threshold', () => {
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(0); // diff = 0 - 1 = -1 < -0.5

    strategy['onCandleAfterWarmup'](candle);

    expect(advices).toHaveLength(1);
    expect(advices[0]).toBe('short');
  });

  it('should resets trend when switching from up to down', () => {
    // Uptrend first
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(2);
    strategy['onCandleAfterWarmup'](candle); // long

    // Now a downtrend
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(0);
    strategy['onCandleAfterWarmup'](candle); // short

    expect(advices).toEqual(['long', 'short']);
  });

  it('should do nothing when diff within thresholds', () => {
    dema.getResult.mockReturnValue(1);
    sma.getResult.mockReturnValue(1); // diff = 0

    strategy['onCandleAfterWarmup'](candle);

    expect(advices).toHaveLength(0);
  });
});
