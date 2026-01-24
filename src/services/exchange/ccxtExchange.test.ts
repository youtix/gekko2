import { ONE_MINUTE } from '@constants/time.const';
import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { Heart } from '@services/core/heart/heart';
import ccxt from 'ccxt';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { CCXTExchange } from './ccxtExchange';
import {
  checkMandatoryFeatures,
  checkOrderAmount,
  checkOrderPrice,
  createExchange,
  mapCcxtOrderToOrder,
  mapCcxtTradeToTrade,
  mapOhlcvToCandles,
  retry,
} from './exchange.utils';

vi.mock('@services/configuration/configuration', () => ({
  config: { getWatch: vi.fn(), getExchange: vi.fn() },
}));
vi.mock('@services/core/heart/heart');
vi.mock('./exchange.utils', () => ({
  createExchange: vi.fn(),
  retry: vi.fn(),
  checkOrderAmount: vi.fn(),
  checkOrderPrice: vi.fn(),
  checkOrderCost: vi.fn(),
  checkMandatoryFeatures: vi.fn(),
  mapCcxtOrderToOrder: vi.fn(),
  mapCcxtTradeToTrade: vi.fn(),
  mapOhlcvToCandles: vi.fn(),
}));
vi.mock('@services/logger', () => ({ error: vi.fn(), debug: vi.fn() }));

vi.mock('ccxt', () => {
  const has = {
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
  const MockExchange = vi.fn();
  MockExchange.prototype.has = has;
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

  return { default: { binance: MockExchange, hyperliquid: MockExchange } };
});

const mockWatchConfig = { pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }] };
const binanceConfig = {
  name: 'binance' as const,
  apiKey: 'key',
  secret: 'secret',
  sandbox: false,
  verbose: false,
  exchangeSynchInterval: 10000,
  orderSynchInterval: 5000,
};
const hyperliquidConfig = {
  name: 'hyperliquid' as const,
  privateKey: 'pk',
  walletAddress: 'addr',
  verbose: false,
  exchangeSynchInterval: 10000,
  orderSynchInterval: 5000,
};

describe('CCXTExchange', () => {
  beforeEach(() => {
    (config.getWatch as Mock).mockReturnValue(mockWatchConfig);
    (retry as Mock).mockImplementation(async fn => fn());
    (checkOrderAmount as Mock).mockReturnValue(1);
    (checkOrderPrice as Mock).mockReturnValue(100);

    // Mock createExchange to return both publicClient and privateClient
    (createExchange as Mock).mockImplementation(config => {
      const exchangeClass = (ccxt as any)[config.name];
      return {
        publicClient: new exchangeClass(),
        privateClient: new exchangeClass(),
      };
    });
  });

  describe('Constructor', () => {
    it.each`
      exchangeName     | config               | expectedName
      ${'binance'}     | ${binanceConfig}     | ${'binance'}
      ${'hyperliquid'} | ${hyperliquidConfig} | ${'hyperliquid'}
    `('initializes $exchangeName exchange correctly', ({ config: cfg, expectedName }) => {
      expect(new CCXTExchange(cfg).getExchangeName()).toBe(expectedName);
    });

    it.each`
      sandbox
      ${true}
      ${false}
    `('creates exchange with sandbox=$sandbox', ({ sandbox }) => {
      new CCXTExchange({ ...binanceConfig, sandbox });
      expect(createExchange).toHaveBeenCalledWith({ ...binanceConfig, sandbox });
    });

    it('throws when required feature is missing', () => {
      (checkMandatoryFeatures as Mock).mockImplementationOnce(() => {
        throw new Error('Missing fetchOHLCV feature');
      });
      expect(() => new CCXTExchange(binanceConfig)).toThrow('Missing fetchOHLCV feature');
    });
  });

  describe('Market Operations', () => {
    let exchange: CCXTExchange;
    let instance: any;

    beforeEach(() => {
      exchange = new CCXTExchange(binanceConfig);
      instance = (ccxt as any).binance.mock.instances.at(-1);
    });

    it('loadMarkets calls client loadMarkets', async () => {
      await exchange.loadMarkets();
      expect(instance.loadMarkets).toHaveBeenCalled();
    });

    it('getMarketData returns market limits and fees (using first configured pair)', () => {
      instance.market.mockReturnValue({
        limits: { amount: { min: 0.1 }, price: { min: 1 }, cost: { min: 10 } },
        precision: { price: 2, amount: 4 },
        maker: 0.001,
        taker: 0.002,
      });
      expect(exchange.getMarketData('BTC/USDT')).toMatchObject({
        amount: { min: 0.1 },
        fee: { maker: 0.001, taker: 0.002 },
      });
      expect(instance.market).toHaveBeenCalledWith('BTC/USDT');
    });

    it('getExchangeName returns configured name', () => {
      expect(exchange.getExchangeName()).toBe('binance');
    });
  });

  describe('fetchTicker', () => {
    let exchange: CCXTExchange;
    let instance: any;

    beforeEach(() => {
      exchange = new CCXTExchange(binanceConfig);
      instance = (ccxt as any).binance.mock.instances.at(-1);
    });

    it('returns formatted ticker with ask and bid', async () => {
      instance.fetchTicker.mockResolvedValue({ ask: 101, bid: 100, last: 100.5 });
      expect(await exchange.fetchTicker('BTC/USDT')).toEqual({ ask: 101, bid: 100 });
      expect(instance.fetchTicker).toHaveBeenCalledTimes(1);
      expect(instance.fetchTicker.mock.calls[0][0]).toBe('BTC/USDT');
    });

    it('throws when last price is nil', async () => {
      instance.fetchTicker.mockResolvedValue({ ask: null, bid: null, last: null });
      await expect(exchange.fetchTicker('BTC/USDT')).rejects.toThrow(GekkoError);
    });
  });

  describe('fetchOHLCV', () => {
    it('fetches and maps candles', async () => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      const ohlcv = [[1000, 1, 2, 1, 1.5, 100]];
      const candles = [{ start: 1000 }];
      instance.fetchOHLCV.mockResolvedValue(ohlcv);
      (mapOhlcvToCandles as Mock).mockReturnValue(candles);
      expect(await exchange.fetchOHLCV('BTC/USDT', { limit: 50, from: 1000 })).toEqual(candles);
      expect(instance.fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', '1m', 1000, 50);
    });
  });

  describe('fetchMyTrades', () => {
    it('fetches and maps trades', async () => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.fetchMyTrades.mockResolvedValue([{ id: '1' }]);
      (mapCcxtTradeToTrade as Mock).mockImplementation(t => t);
      expect(await exchange.fetchMyTrades('BTC/USDT', 1000)).toEqual([{ id: '1' }]);
      expect(instance.fetchMyTrades).toHaveBeenCalledWith('BTC/USDT', 1000, expect.anything());
    });
  });

  describe('fetchOrder', () => {
    it('fetches and maps order', async () => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.fetchOrder.mockResolvedValue({ id: '1' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1' });
      expect(await exchange.fetchOrder('BTC/USDT', '1')).toEqual({ id: '1' });
      expect(instance.fetchOrder).toHaveBeenCalledWith('1', 'BTC/USDT');
    });
  });

  describe('fetchBalance', () => {
    it('extracts asset and currency balances from first pair', async () => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.fetchBalance.mockResolvedValue({ BTC: { free: 1.5 }, USDT: { free: 1000 } });
      instance.market.mockReturnValue({ baseName: 'BTC', quote: 'USDT' });
      const balance = await exchange.fetchBalance();
      expect(balance.get('BTC')).toEqual({ free: 1.5, used: 0, total: 0 });
      expect(balance.get('USDT')).toEqual({ free: 1000, used: 0, total: 0 });
      expect(instance.market).toHaveBeenCalledWith('BTC/USDT');
    });
  });

  describe('createLimitOrder', () => {
    it.each`
      side
      ${'BUY'}
      ${'SELL'}
    `('creates $side limit order with validation', async ({ side }) => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.market.mockReturnValue({ limits: {} });
      instance.createOrder.mockResolvedValue({ id: '1' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1' });
      await exchange.createLimitOrder('BTC/USDT', side, 1, 100);
      expect(instance.createOrder).toHaveBeenCalledWith('BTC/USDT', 'limit', side, 1, 100);
    });
  });

  describe('createMarketOrder', () => {
    it.each`
      side      | tickerPrice
      ${'BUY'}  | ${101}
      ${'SELL'} | ${100}
    `('creates $side market order', async ({ side }) => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.market.mockReturnValue({ limits: {} });
      instance.fetchTicker.mockResolvedValue({ ask: 101, bid: 100, last: 100.5 });
      instance.createOrder.mockResolvedValue({ id: '1' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1' });
      await exchange.createMarketOrder('BTC/USDT', side, 1);
      expect(instance.createOrder).toHaveBeenCalledWith('BTC/USDT', 'market', side, 1);
    });
  });

  describe('cancelOrder', () => {
    it('cancels and returns mapped order', async () => {
      const exchange = new CCXTExchange(binanceConfig);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.cancelOrder.mockResolvedValue({ id: '1', status: 'canceled' });
      (mapCcxtOrderToOrder as Mock).mockReturnValue({ id: '1', status: 'canceled' });
      expect(await exchange.cancelOrder('BTC/USDT', '1')).toEqual({ id: '1', status: 'canceled' });
      expect(instance.cancelOrder).toHaveBeenCalledWith('1', 'BTC/USDT');
    });
  });

  describe('onNewCandle', () => {
    let exchange: CCXTExchange;

    beforeEach(() => {
      exchange = new CCXTExchange(binanceConfig);
    });

    it('sets up heartbeat polling', () => {
      exchange.onNewCandle('BTC/USDT', vi.fn());
      expect(Heart).toHaveBeenCalledWith(ONE_MINUTE);
    });

    it('calls callback when candle is fetched', async () => {
      const callback = vi.fn();
      const candle = { start: 1000 };
      (mapOhlcvToCandles as Mock).mockReturnValue([candle]);
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.fetchOHLCV.mockResolvedValue([[1000, 1, 2, 1, 1.5, 100]]);

      exchange.onNewCandle('BTC/USDT', callback);
      const heartInstance = (Heart as unknown as Mock).mock.instances.at(-1);
      await (heartInstance as any).on.mock.calls[0][1]();

      expect(callback).toHaveBeenCalledWith('BTC/USDT', candle);
      expect(instance.fetchOHLCV).toHaveBeenCalledWith('BTC/USDT', expect.anything(), expect.anything(), expect.anything());
    });

    it('logs error when fetch fails', async () => {
      const { error } = await import('@services/logger');
      const instance = (ccxt as any).binance.mock.instances.at(-1);
      instance.fetchOHLCV.mockRejectedValue(new Error('Network error'));

      exchange.onNewCandle('BTC/USDT', vi.fn());
      const heartInstance = (Heart as unknown as Mock).mock.instances.at(-1);
      await (heartInstance as any).on.mock.calls[0][1]();

      expect(error).toHaveBeenCalledWith('exchange', expect.stringContaining('Failed to poll'));
    });

    it('returns stop function', () => {
      const stop = exchange.onNewCandle('BTC/USDT', vi.fn());
      stop();
      const heartInstance = (Heart as unknown as Mock).mock.instances.at(-1);
      expect((heartInstance as any).stop).toHaveBeenCalled();
    });
  });
});
