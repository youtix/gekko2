import { Candle } from '@models/candle.types';
import { config } from '@services/configuration/configuration';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CCXTExchange } from '../ccxtExchange';
import { DummyCentralizedExchange } from '../dummy/dummyCentralizedExchange';
import { PaperTradingBinanceExchange } from './paperTradingBinanceExchange';

vi.mock('@services/configuration/configuration', () => ({
  config: { getWatch: vi.fn(), getExchange: vi.fn() },
}));
vi.mock('@services/logger', () => ({ info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

vi.mock('../ccxtExchange', () => {
  const MockCCXT = vi.fn();
  MockCCXT.prototype.loadMarkets = vi.fn().mockResolvedValue(undefined);
  MockCCXT.prototype.fetchTicker = vi.fn().mockResolvedValue({ ask: 100, bid: 99 });
  MockCCXT.prototype.fetchOHLCV = vi.fn().mockResolvedValue([]);
  MockCCXT.prototype.getMarketData = vi.fn().mockReturnValue({
    amount: {},
    price: {},
    cost: {},
    precision: {},
    fee: { maker: 0.001, taker: 0.002 },
  });
  MockCCXT.prototype.onNewCandle = vi.fn().mockReturnValue(() => {});
  return { CCXTExchange: MockCCXT };
});

vi.mock('../dummy/dummyCentralizedExchange', () => {
  const MockDummy = vi.fn();
  MockDummy.prototype.fetchBalance = vi.fn().mockResolvedValue({ asset: { free: 1 }, currency: { free: 10000 } });
  MockDummy.prototype.createLimitOrder = vi.fn().mockResolvedValue({ id: 'order-1', status: 'open' });
  MockDummy.prototype.createMarketOrder = vi.fn().mockResolvedValue({ id: 'order-2', status: 'closed' });
  MockDummy.prototype.cancelOrder = vi.fn().mockResolvedValue({ id: 'order-1', status: 'canceled' });
  MockDummy.prototype.fetchOrder = vi.fn().mockResolvedValue({ id: 'order-1', status: 'open' });
  MockDummy.prototype.fetchMyTrades = vi.fn().mockResolvedValue([]);
  MockDummy.prototype.processOneMinuteCandle = vi.fn().mockResolvedValue(undefined);
  return { DummyCentralizedExchange: MockDummy };
});

const mockWatchConfig = { pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }] };
const mockExchangeConfig = {
  name: 'paper-binance' as const,
  verbose: false,
  simulationBalance: { asset: 1, currency: 10000 },
  exchangeSynchInterval: 10000,
  orderSynchInterval: 5000,
};

describe('PaperTradingBinanceExchange', () => {
  beforeEach(() => {
    (config.getWatch as Mock).mockReturnValue(mockWatchConfig);
  });

  describe('Constructor', () => {
    it('returns paper-binance as exchange name', () => {
      expect(new PaperTradingBinanceExchange(mockExchangeConfig).getExchangeName()).toBe('paper-binance');
    });

    it('creates CCXTExchange with binance config', () => {
      new PaperTradingBinanceExchange(mockExchangeConfig);
      expect(CCXTExchange).toHaveBeenCalledWith(expect.objectContaining({ name: 'binance' }));
    });
  });

  describe('loadMarkets', () => {
    it('loads markets from real exchange', async () => {
      const exchange = new PaperTradingBinanceExchange(mockExchangeConfig);
      await exchange.loadMarkets();
      expect(CCXTExchange.prototype.loadMarkets).toHaveBeenCalled();
    });

    it('creates DummyCentralizedExchange with simulation config', async () => {
      const exchange = new PaperTradingBinanceExchange(mockExchangeConfig);
      await exchange.loadMarkets();
      expect(DummyCentralizedExchange).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'dummy-cex', simulationBalance: mockExchangeConfig.simulationBalance }),
      );
    });

    it('applies fee override when provided', async () => {
      const configWithFee = { ...mockExchangeConfig, feeOverride: { maker: 0.0005, taker: 0.001 } };
      const exchange = new PaperTradingBinanceExchange(configWithFee);
      await exchange.loadMarkets();
      expect(DummyCentralizedExchange).toHaveBeenCalledWith(
        expect.objectContaining({ marketData: expect.objectContaining({ fee: { maker: 0.0005, taker: 0.001 } }) }),
      );
    });
  });

  describe('Unauthenticated Operations (CCXTExchange)', () => {
    let exchange: PaperTradingBinanceExchange;

    beforeEach(async () => {
      exchange = new PaperTradingBinanceExchange(mockExchangeConfig);
      await exchange.loadMarkets();
    });

    it('fetchOHLCV delegates to real exchange', async () => {
      await exchange.fetchOHLCV({ limit: 10 });
      expect(CCXTExchange.prototype.fetchOHLCV).toHaveBeenCalledWith({ limit: 10 });
    });

    it('fetchTicker delegates to real exchange', async () => {
      await exchange.fetchTicker();
      expect(CCXTExchange.prototype.fetchTicker).toHaveBeenCalled();
    });

    it('getMarketData delegates to real exchange', () => {
      exchange.getMarketData();
      expect(CCXTExchange.prototype.getMarketData).toHaveBeenCalled();
    });

    it('onNewCandle delegates to real exchange', () => {
      const callback = vi.fn();
      exchange.onNewCandle(callback);
      expect(CCXTExchange.prototype.onNewCandle).toHaveBeenCalledWith(callback);
    });
  });

  describe('Authenticated Operations (DummyCentralizedExchange)', () => {
    let exchange: PaperTradingBinanceExchange;

    beforeEach(async () => {
      exchange = new PaperTradingBinanceExchange(mockExchangeConfig);
      await exchange.loadMarkets();
    });

    it('fetchBalance delegates to simulated exchange', async () => {
      await exchange.fetchBalance();
      expect(DummyCentralizedExchange.prototype.fetchBalance).toHaveBeenCalled();
    });

    it('createLimitOrder delegates to simulated exchange', async () => {
      await exchange.createLimitOrder('BUY', 0.1, 100);
      expect(DummyCentralizedExchange.prototype.createLimitOrder).toHaveBeenCalledWith('BUY', 0.1, 100, undefined);
    });

    it('createMarketOrder delegates to simulated exchange', async () => {
      await exchange.createMarketOrder('SELL', 0.5);
      expect(DummyCentralizedExchange.prototype.createMarketOrder).toHaveBeenCalledWith('SELL', 0.5);
    });

    it('cancelOrder delegates to simulated exchange', async () => {
      await exchange.cancelOrder('order-1');
      expect(DummyCentralizedExchange.prototype.cancelOrder).toHaveBeenCalledWith('order-1');
    });

    it('fetchOrder delegates to simulated exchange', async () => {
      await exchange.fetchOrder('order-1');
      expect(DummyCentralizedExchange.prototype.fetchOrder).toHaveBeenCalledWith('order-1');
    });

    it('fetchMyTrades delegates to simulated exchange', async () => {
      await exchange.fetchMyTrades(1000);
      expect(DummyCentralizedExchange.prototype.fetchMyTrades).toHaveBeenCalledWith(1000);
    });

    it('processOneMinuteCandle delegates to simulated exchange', async () => {
      const candle: Candle = { start: 1000, open: 100, high: 110, low: 90, close: 105, volume: 1000 };
      await exchange.processOneMinuteCandle(candle);
      expect(DummyCentralizedExchange.prototype.processOneMinuteCandle).toHaveBeenCalledWith(candle);
    });
  });
});
