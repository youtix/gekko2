import { describe, expect, it, Mock, vi } from 'vitest';
import { Candle } from '../../../../models/types/candle.types';
import * as utils from '../../../../utils/candle/candle.utils';
import { config } from '../../../configuration/configuration';
import { GapFillerStream } from './gapFiller.stream';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({ getWatch: vi.fn() }));
  return { config: new Configuration() };
});
vi.mock('@services/storage/injecter/injecter', () => ({
  inject: {
    secondaryBroker: vi.fn(() => ({
      getBrokerName: () => 'binance',
      fetchOHLCV: vi.fn(),
    })),
  },
}));
vi.mock('@utils/candle/candle.utils', () => ({
  fillMissingCandles: vi.fn(),
  // bridgeCandleGap: vi.fn(),
}));

const candleFactory = (start: number, open: number, close: number, high: number, low: number, volume: number) => ({
  start,
  open,
  close,
  high,
  low,
  volume,
});

describe('GapFillerStream', () => {
  const startCandle = candleFactory(1000, 100, 100, 110, 90, 10);
  const endCandle = candleFactory(4000, 105, 105, 115, 95, 12);
  const getWatchMock = config.getWatch as Mock;
  const fillMissingCandlesMock = utils.fillMissingCandles as Mock;
  // const bridgeCandleGapMock = utils.bridgeCandleGap as Mock;
  let stream: GapFillerStream;

  const resetStream = () => {
    return new Promise(resolve => {
      stream = new GapFillerStream();
      const results: Candle[] = [];
      stream.on('data', data => results.push(data));
      stream.on('end', () => resolve(results));
      stream.write(startCandle);
      stream.write(endCandle);
      stream.end();
    });
  };

  it('should pass through candles without filling gaps when mode is "no"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'no', mode: 'backtest' });
    const results = await resetStream();
    expect(results).toEqual([startCandle, endCandle]);
  });

  it('should fill gaps with empty candles when mode is "empty"', async () => {
    getWatchMock.mockReturnValue({ fillGaps: 'empty', mode: 'realtime' });
    const candle2 = candleFactory(2000, 100, 100, 110, 90, 0);
    const candle3 = candleFactory(3000, 100, 100, 110, 90, 0);
    fillMissingCandlesMock.mockReturnValue([startCandle, candle2, candle3, endCandle]);
    const results = await resetStream();
    expect(results).toEqual([startCandle, candle2, candle3, endCandle]);
  });

  // it('should fill gaps with broker candles when mode is "broker"', async () => {
  //   const candle2 = candleFactory(2000, 100, 100, 110, 90, 0);
  //   const candle3 = candleFactory(3000, 100, 100, 110, 90, 0);
  //   bridgeCandleGapMock.mockReturnValue([candle2, candle3]);
  //   getWatchMock.mockReturnValue({ fillGaps: 'broker', mode: 'importer' });
  //   const results = await resetStream();
  //   expect(results).toEqual([startCandle, candle2, candle3, endCandle]);
  // });
});
