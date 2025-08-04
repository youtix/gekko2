import { GekkoError } from '@errors/gekko.error';
import { describe, expect, it, Mock, vi } from 'vitest';
import { Candle } from '../../../../models/types/candle.types';
import { inject } from '../../../injecter/injecter';
import { TradeBatcher } from '../../batcher/tradeBatcher/tradeBatcher';
import { CandleManager } from '../../candleManager/candleManager';
import { RealtimeStream } from './realtime.stream';

vi.mock('@services/logger', () => ({ warning: vi.fn() }));
vi.mock('@services/injecter/injecter', () => ({
  inject: { broker: vi.fn() },
}));
vi.mock('@services/core/heart/heart', () => ({
  Heart: vi.fn(() => ({
    on: vi.fn(),
    pump: vi.fn(),
    stop: vi.fn(),
  })),
}));
vi.mock('@services/core/batcher/tradeBatcher/tradeBatcher', () => ({
  TradeBatcher: vi.fn(() => ({ processTrades: vi.fn() })),
}));
vi.mock('@services/core/candleManager/candleManager', () => ({
  CandleManager: vi.fn(() => ({ processBacth: vi.fn() })),
}));

describe('RealtimeStream', () => {
  const candle: Candle = { start: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 };
  const injectBrokerMock = inject.broker as Mock;
  const fetchTrades = vi.fn();

  it('should push candles when trades are available', async () => {
    fetchTrades.mockResolvedValue([{ id: 't1' }]);
    injectBrokerMock.mockReturnValue({ fetchTrades });

    const processTrades = vi.fn().mockReturnValue({ data: ['t1'] });
    const processBacth = vi.fn().mockReturnValue([candle]);

    (TradeBatcher as unknown as Mock).mockImplementation(() => ({ processTrades }));
    (CandleManager as unknown as Mock).mockImplementation(() => ({ processBacth }));

    const stream = new RealtimeStream({ tickrate: 1 });
    const results: Candle[] = [];
    stream.on('data', data => results.push(data));

    await stream.onTick();
    await new Promise(resolve => process.nextTick(resolve));

    expect(results).toEqual([candle]);
  });
  it('should throw when there is missing id property in fetched trades', async () => {
    fetchTrades.mockResolvedValue([{}]);
    injectBrokerMock.mockReturnValue({ fetchTrades });

    const stream = new RealtimeStream({ tickrate: 1 });
    await expect(stream.onTick()).rejects.toThrow(GekkoError);
  });
});
