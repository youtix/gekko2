import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { Heart } from '@services/core/heart/heart';
import ccxt from 'ccxt';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CCXTExchange } from './ccxtExchange';
import {
  checkOrderAmount,
  checkOrderCost,
  checkOrderPrice,
  mapCcxtOrderToOrder,
  mapCcxtTradeToTrade,
  mapOhlcvToCandles,
  retry,
} from './exchange.utils';

// Mocks
vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
    getExchange: vi.fn(),
  },
}));

vi.mock('@services/core/heart/heart');
vi.mock('./exchange.utils');

vi.mock('ccxt', () => {
  const MockExchange = vi.fn();
  MockExchange.prototype.has = {
    fetchOHLCV: true,
    fetchTicker: true,
    fetchMyTrades: true,
    fetchOrder: true,
    fetchBalance: true,
    createOrder: true,
    createLimitOrder: true,
    createMarketOrder: true,
    cancelOrder: true,
    loadMarkets: true,
    sandbox: true,
    market: true,
  };
  MockExchange.prototype.setSandboxMode = vi.fn();
  MockExchange.prototype.loadMarkets = vi.fn();
  MockExchange.prototype.fetchTicker = vi.fn();
  MockExchange.prototype.fetchOHLCV = vi.fn();
  MockExchange.prototype.fetchMyTrades = vi.fn();
  MockExchange.prototype.fetchOrder = vi.fn();
  MockExchange.prototype.fetchBalance = vi.fn();
  MockExchange.prototype.createOrder = vi.fn();
  MockExchange.prototype.cancelOrder = vi.fn();
  MockExchange.prototype.market = vi.fn();
  MockExchange.prototype.options = {};

  return {
    default: {
      binance: MockExchange,
      hyperliquid: MockExchange,
    },
  };
});

describe('CCXTExchange', () => {
  let exchange: CCXTExchange;

  const mockWatchConfig = { asset: 'BTC', currency: 'USDT' };
  const mockExchangeConfig = {
    name: 'binance',
    key: 'test-key',
    secret: 'test-secret',
    sandbox: false,
    verbose: false,
  };

  beforeEach(() => {
    (config.getWatch as Mock).mockReturnValue(mockWatchConfig);
    (config.getExchange as Mock).mockReturnValue(mockExchangeConfig);

    // Reset mock implementation for retry to just execute the function
    (retry as Mock).mockImplementation(async fn => fn());

    // Setup default successful responses for utils
    (checkOrderAmount as Mock).mockReturnValue(1);
    (checkOrderPrice as Mock).mockReturnValue(100);
  });

  describe('Constructor', () => {
    it('should initialize correctly with valid config', () => {
      exchange = new CCXTExchange();
      expect(config.getWatch).toHaveBeenCalled();
      expect(config.getExchange).toHaveBeenCalled();
      expect(exchange.getExchangeName()).toBe('binance');
    });

    it('should throw error if exchange is "dummy-cex"', () => {
      (config.getExchange as Mock).mockReturnValue({ ...mockExchangeConfig, name: 'dummy-cex' });
      expect(() => new CCXTExchange()).toThrow(GekkoError);
      expect(() => new CCXTExchange()).toThrow('Dummy exchange is not supported with CCXT library');
    });

    it('should set sandbox mode if configured', () => {
      (config.getExchange as Mock).mockReturnValue({ ...mockExchangeConfig, sandbox: true });
      new CCXTExchange();
      // Since we can't easily access the internal client directly without casting or modifying the class to be public/protected accessible for tests,
      // we can check if the constructor logic ran.
      // Ideally we would check `mockCcxtClient.setSandboxMode` but strictly speaking `new` creates a NEW instance.
      // For unit testing the `ccxt` mock returns the class.
      // We can verify calls on the prototype or the instance if we could capture it.
      // Given the mock setup:
      // The `ccxt.binance` is a Jest mock function (class).
      // Initialization calls `setSandboxMode`.
      // Let's verify the mock instances.
      const MockExchangeClass = (ccxt as any).binance;
      // The last instance created:
      const instance = MockExchangeClass.mock.instances[0];
      expect(instance.setSandboxMode).toHaveBeenCalledWith(true);
    });

    it('should throw error if required feature is missing', () => {
      // We need to modify the mock for this specific test or spy on it.
      // Since the mock is hoisted, we can't easily change the prototype 'has' property for just one test without affecting others if not careful.
      // However, we can mock the class implementation for this test.
      const MockExchangeClass = (ccxt as any).binance;
      // We'll temporarily override the prototype for the next instance
      const originalHas = MockExchangeClass.prototype.has;
      MockExchangeClass.prototype.has = { ...originalHas, fetchOHLCV: false };

      expect(() => new CCXTExchange()).toThrow(GekkoError);
      expect(() => new CCXTExchange()).toThrow('Missing fetchOHLCV feature');

      // Restore
      MockExchangeClass.prototype.has = originalHas;
    });
  });

  describe('Public Methods', () => {
    beforeEach(() => {
      exchange = new CCXTExchange();
    });

    it('getMarketData should return limits from client', () => {
      const mockLimits = { amount: { min: 0.1 }, price: { min: 1 } };
      const MockExchangeClass = (ccxt as any).binance;
      const instance = MockExchangeClass.mock.instances[0];
      instance.market.mockReturnValue({ limits: mockLimits });

      const result = exchange.getMarketData();
      expect(instance.market).toHaveBeenCalledWith('BTC/USDT');
      expect(result).toMatchObject(mockLimits);
    });

    it('onNewCandle should setup heartbeat and polling', async () => {
      const mockCandle = { start: 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 };
      (mapOhlcvToCandles as Mock).mockReturnValue([mockCandle]);

      const MockExchangeClass = (ccxt as any).binance;
      const instance = MockExchangeClass.mock.instances[0];
      instance.fetchOHLCV.mockResolvedValue([[1000, 1, 2, 0.5, 1.5, 100]]);

      // Verify Heart usage
      const onNewCandleCallback = vi.fn();
      const stopFn = exchange.onNewCandle(onNewCandleCallback);

      expect(Heart).toHaveBeenCalledWith(ONE_MINUTE);
      const heartInstance: any = (Heart as unknown as Mock).mock.instances[0];
      expect(heartInstance.on).toHaveBeenCalledWith('tick', expect.any(Function));

      // Simulate tick
      const tickCallback = heartInstance.on.mock.calls[0][1];
      await tickCallback();

      expect(instance.fetchOHLCV).toHaveBeenCalled();
      expect(onNewCandleCallback).toHaveBeenCalledWith(mockCandle);

      stopFn();
      expect(heartInstance.stop).toHaveBeenCalled();
    });

    it('loadMarkets should call client loadMarkets', async () => {
      await exchange.loadMarkets();
      const instance = (ccxt as any).binance.mock.instances[0];
      expect(instance.loadMarkets).toHaveBeenCalled();
    });

    it('fetchTicker should fetch and format ticker', async () => {
      const mockTickerResponse = { ask: 101, bid: 100, last: 100.5 };
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchTicker.mockResolvedValue(mockTickerResponse);

      const result = await exchange.fetchTicker();
      expect(instance.fetchTicker).toHaveBeenCalledWith('BTC/USDT', undefined);
      expect(result).toEqual({ ask: 101, bid: 100 });
    });

    it('fetchTicker should throw error if ask/bid missing', async () => {
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchTicker.mockResolvedValue({ ask: null, bid: 100 });

      await expect(exchange.fetchTicker()).rejects.toThrow(GekkoError);
    });

    it('fetchOHLCV should fetch and map candles', async () => {
      const mockOhlcv = [[1000, 1, 2, 1, 1.5, 100]];
      const mockCandles = [{ start: 1000 }];
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchOHLCV.mockResolvedValue(mockOhlcv);
      (mapOhlcvToCandles as Mock).mockReturnValue(mockCandles);

      const result = await exchange.fetchOHLCV({ limit: 50, from: 1000 });

      expect(instance.fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1m', 1000, 50);
      expect(mapOhlcvToCandles).toHaveBeenCalledWith(mockOhlcv);
      expect(result).toEqual(mockCandles);
    });

    it('fetchMyTrades should fetch and map trades', async () => {
      const mockCcxtTrades = [{ id: '1', price: 100 }];
      const mockTrades = [{ id: '1', price: 100 }];
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchMyTrades.mockResolvedValue(mockCcxtTrades);
      (mapCcxtTradeToTrade as Mock).mockImplementation(t => t);

      const result = await exchange.fetchMyTrades(1000);

      expect(instance.fetchMyTrades).toHaveBeenCalledWith('BTC/USDT', 1000, expect.anything());
      expect(result).toEqual(mockTrades);
    });

    it('fetchOrder should fetch and map order', async () => {
      const mockCcxtOrder = { id: '1' };
      const mockOrder = { id: '1' };
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchOrder.mockResolvedValue(mockCcxtOrder);
      (mapCcxtOrderToOrder as Mock).mockReturnValue(mockOrder);

      const result = await exchange.fetchOrder('1');

      expect(instance.fetchOrder).toHaveBeenCalledWith('1', 'BTC/USDT');
      expect(mapCcxtOrderToOrder).toHaveBeenCalledWith(mockCcxtOrder);
      expect(result).toEqual(mockOrder);
    });

    it('fetchBalance should fetch and extract balance', async () => {
      const mockBalance = {
        BTC: { free: 1.5 },
        USDT: { free: 1000 },
      };
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.fetchBalance.mockResolvedValue(mockBalance);
      instance.market.mockReturnValue({ baseName: 'BTC', quote: 'USDT' });

      const result = await exchange.fetchBalance();

      expect(instance.fetchBalance).toHaveBeenCalled();
      expect(result).toEqual({
        asset: { free: 1.5, used: 0, total: 0 },
        currency: { free: 1000, used: 0, total: 0 },
      });
    });

    it.each`
      side      | amount | price  | expectedSide
      ${'BUY'}  | ${1}   | ${100} | ${'BUY'}
      ${'SELL'} | ${1}   | ${100} | ${'SELL'}
    `('createLimitOrder should check limits and create $side order', async ({ side, amount, price, expectedSide }) => {
      const mockLimits = {};
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.market.mockReturnValue({ limits: mockLimits });
      instance.createOrder.mockResolvedValue({ id: '1' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1' });

      await exchange.createLimitOrder(side, amount, price);

      expect(checkOrderPrice).toHaveBeenCalledWith(price, mockLimits);
      expect(checkOrderAmount).toHaveBeenCalledWith(amount, mockLimits);
      expect(checkOrderCost).toHaveBeenCalled();
      expect(instance.createOrder).toHaveBeenCalledWith(
        'BTC/USDT',
        'limit',
        expectedSide,
        expect.any(Number),
        expect.any(Number),
      );
    });

    it.each`
      side      | amount
      ${'BUY'}  | ${1}
      ${'SELL'} | ${1}
    `('createMarketOrder should fetch ticker, check limits and create $side order', async ({ side, amount }) => {
      const mockLimits = {};
      const mockTicker = { ask: 101, bid: 100, last: 100.5 };
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.market.mockReturnValue({ limits: mockLimits });
      instance.fetchTicker.mockResolvedValue(mockTicker); // Mock internal fetchTicker call via client or method mock?
      // Note: exchange.fetchTicker calls client.fetchTicker. We already mocked client.fetchTicker.
      instance.createOrder.mockResolvedValue({ id: '1' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1' });

      await exchange.createMarketOrder(side, amount);

      expect(checkOrderAmount).toHaveBeenCalledWith(amount, mockLimits);
      // It fetches ticker internally
      expect(instance.createOrder).toHaveBeenCalledWith('BTC/USDT', 'market', side, expect.any(Number));
    });

    it('cancelOrder should cancel and map order', async () => {
      const instance = (ccxt as any).binance.mock.instances[0];
      instance.cancelOrder.mockResolvedValue({ id: '1', status: 'canceled' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1', status: 'canceled' });

      const result = await exchange.cancelOrder('1');

      expect(instance.cancelOrder).toHaveBeenCalledWith('1', 'BTC/USDT');
      expect(result).toEqual({ id: '1', status: 'canceled' });
    });
  });
});
