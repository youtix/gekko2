import { GekkoError } from '@errors/gekko.error';
import { config } from '@services/configuration/configuration';
import { debug, error, info } from '@services/logger';
import type { Mock } from 'vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidOrder, OrderNotFound } from '../../exchange.error';
import { BinanceExchange } from './binance';
import {
  mapAccountTradeToTrade,
  mapKlinesToCandles,
  mapPublicTradeToTrade,
  mapSpotOrderToOrder,
} from './binance.utils';

const state = vi.hoisted(() => {
  const createMainClientMock = () => ({
    getExchangeInfo: vi.fn(),
    getSymbolOrderBookTicker: vi.fn(),
    getKlines: vi.fn(),
    getRecentTrades: vi.fn(),
    getAccountTradeList: vi.fn(),
    getAccountInformation: vi.fn(),
    getOrder: vi.fn(),
    submitNewOrder: vi.fn(),
    cancelOrder: vi.fn(),
  });

  const createWebsocketMock = () => ({
    on: vi.fn(),
    off: vi.fn(),
    subscribeKlines: vi.fn(),
    unsubscribe: vi.fn(),
  });

  return {
    createMainClientMock,
    createWebsocketMock,
    mainClientMock: undefined as ReturnType<typeof createMainClientMock> | undefined,
    websocketMock: undefined as ReturnType<typeof createWebsocketMock> | undefined,
    mainClientCtor: undefined as Mock | undefined,
    websocketCtor: undefined as Mock | undefined,
  };
});

vi.mock('binance', () => {
  state.mainClientMock = state.createMainClientMock();
  state.websocketMock = state.createWebsocketMock();
  state.mainClientCtor = vi.fn((..._args: unknown[]) => state.mainClientMock!);
  state.websocketCtor = vi.fn((..._args: unknown[]) => state.websocketMock!);
  return {
    MainClient: state.mainClientCtor,
    WebsocketClient: state.websocketCtor,
    KlineInterval: {},
    SymbolFilter: class {},
    SymbolLotSizeFilter: class {},
    SymbolMinNotionalFilter: class {},
    SymbolPriceFilter: class {},
    WsFormattedMessage: class {},
  };
});

let mainClientMock = state.mainClientMock!;
let websocketMock = state.websocketMock!;
const mainClientCtor = state.mainClientCtor!;
const websocketCtor = state.websocketCtor!;
const { createMainClientMock, createWebsocketMock } = state;

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(),
  },
}));

vi.mock('./binance.utils', () => ({
  mapAccountTradeToTrade: vi.fn(),
  mapKlinesToCandles: vi.fn(),
  mapPublicTradeToTrade: vi.fn(),
  mapSpotOrderToOrder: vi.fn(),
}));

const getWatchMock = config.getWatch as unknown as Mock;
const mapAccountTradeToTradeMock = mapAccountTradeToTrade as unknown as Mock;
const mapKlinesToCandlesMock = mapKlinesToCandles as unknown as Mock;
const mapPublicTradeToTradeMock = mapPublicTradeToTrade as unknown as Mock;
const mapSpotOrderToOrderMock = mapSpotOrderToOrder as unknown as Mock;
const debugMock = debug as unknown as Mock;
const infoMock = info as unknown as Mock;
const errorMock = error as unknown as Mock;

const createExchange = (overrides: Partial<ConstructorParameters<typeof BinanceExchange>[0]> = {}) =>
  new BinanceExchange({
    name: 'binance',
    interval: 250,
    key: 'api-key',
    secret: 'api-secret',
    sandbox: true,
    verbose: true,
    ...overrides,
  });

beforeEach(() => {
  vi.clearAllMocks();
  mainClientMock = createMainClientMock();
  websocketMock = createWebsocketMock();
  state.mainClientMock = mainClientMock;
  state.websocketMock = websocketMock;
  mainClientCtor.mockImplementation(() => mainClientMock);
  websocketCtor.mockImplementation(() => websocketMock);
  getWatchMock.mockReturnValue({ asset: 'BTC', currency: 'USDT', mode: 'realtime' });
  mapKlinesToCandlesMock.mockImplementation((value: unknown) => value);
  mapPublicTradeToTradeMock.mockImplementation((trade: any) => ({ mapped: true, trade }));
  mapAccountTradeToTradeMock.mockImplementation((trade: any) => ({ mapped: true, trade }));
  mapSpotOrderToOrderMock.mockImplementation((order: any) => ({ mapped: true, order }));
});

describe('BinanceExchange', () => {
  describe('constructor', () => {
    it('configures REST and WS clients with credentials', () => {
      createExchange();
      const restCall = mainClientCtor.mock.calls[0] ?? [];
      const wsCall = websocketCtor.mock.calls[0] ?? [];
      expect({
        restConfig: restCall[0],
        wsConfig: wsCall[0],
        wsHandlerKeys: Object.keys((wsCall[1] as Record<string, unknown>) ?? {}),
      }).toEqual({
        restConfig: {
          api_key: 'api-key',
          api_secret: 'api-secret',
          beautifyResponses: true,
          testnet: true,
        },
        wsConfig: { beautify: true, testnet: true, api_key: 'api-key', api_secret: 'api-secret' },
        wsHandlerKeys: ['trace', 'info', 'error'],
      });
    });

    it('binds logger wrappers to websocket handlers', () => {
      createExchange();
      const [, handlers] = websocketCtor.mock.calls[0] ?? [];
      if (handlers && typeof handlers === 'object') {
        (handlers as Record<'trace' | 'info' | 'error', (payload: string) => void>).trace('trace');
        (handlers as Record<'trace' | 'info' | 'error', (payload: string) => void>).info('info');
        (handlers as Record<'trace' | 'info' | 'error', (payload: string) => void>).error('err');
      }
      expect({
        trace: debugMock.mock.calls,
        info: infoMock.mock.calls,
        error: errorMock.mock.calls,
      }).toEqual({
        trace: [['exchange', 'trace']],
        info: [['exchange', 'info']],
        error: [['exchange', 'err']],
      });
    });
  });

  describe('onNewCandle', () => {
    it('subscribes and forwards final kline updates', () => {
      const exchange = createExchange();
      const onCandle = vi.fn();
      exchange.onNewCandle(onCandle);
      const handler = websocketMock.on.mock.calls[0]?.[1] as ((msg: unknown) => void) | undefined;
      handler?.({
        eventType: 'kline',
        symbol: 'BTCUSDT',
        kline: {
          final: true,
          startTime: 1,
          open: 2,
          close: 3,
          high: 4,
          low: 5,
          volume: 6,
          volumeActive: 7,
          quoteVolume: 8,
          quoteVolumeActive: 9,
        },
      });
      expect({
        subscribeArgs: websocketMock.subscribeKlines.mock.calls,
        registeredEvent: websocketMock.on.mock.calls[0]?.[0],
        candle: onCandle.mock.calls[0]?.[0],
      }).toEqual({
        subscribeArgs: [['btcusdt', '1m', 'spot']],
        registeredEvent: 'formattedMessage',
        candle: {
          start: 1,
          open: 2,
          close: 3,
          high: 4,
          low: 5,
          volume: 6,
          volumeActive: 7,
          quoteVolume: 8,
          quoteVolumeActive: 9,
        },
      });
    });

    it.each`
      description               | message
      ${'array payload'}        | ${[{}]}
      ${'non-kline event type'} | ${{ eventType: 'depthUpdate' }}
      ${'mismatched symbol'}    | ${{ eventType: 'kline', symbol: 'ETHUSDT', kline: { final: true } }}
      ${'unfinished kline'}     | ${{ eventType: 'kline', symbol: 'BTCUSDT', kline: { final: false } }}
      ${'missing kline data'}   | ${{ eventType: 'kline', symbol: 'BTCUSDT' }}
      ${'missing symbol'}       | ${{ eventType: 'kline', kline: { final: true } }}
    `('ignores $description', ({ message }) => {
      const exchange = createExchange();
      const onCandle = vi.fn();
      exchange.onNewCandle(onCandle);
      const handler = websocketMock.on.mock.calls[0]?.[1] as ((msg: unknown) => void) | undefined;
      try {
        handler?.(message);
      } catch {
        // ignore malformed payload
      }
      expect(onCandle).not.toHaveBeenCalled();
    });

    it('cleans up websocket handlers even if unsubscribe fails', () => {
      const exchange = createExchange();
      const onCandle = vi.fn();
      const dispose = exchange.onNewCandle(onCandle);
      const handler = websocketMock.on.mock.calls[0]?.[1];
      websocketMock.unsubscribe.mockImplementation(() => {
        throw new Error('fail');
      });
      try {
        dispose();
      } catch {
        // intentional
      }
      expect({
        unsubscribe: websocketMock.unsubscribe.mock.calls,
        off: websocketMock.off.mock.calls,
        handlerRegistered: handler,
      }).toEqual({
        unsubscribe: [[['btcusdt'], 'main']],
        off: [['formattedMessage', handler]],
        handlerRegistered: handler,
      });
    });
  });

  describe('loadMarketsImpl', () => {
    it('extracts market limits from exchange filters', async () => {
      const exchange = createExchange();
      mainClientMock.getExchangeInfo.mockResolvedValue({
        symbols: [
          {
            filters: [
              { filterType: 'PRICE_FILTER', minPrice: '0.1', maxPrice: '10' },
              { filterType: 'LOT_SIZE', minQty: '0.01', maxQty: '5' },
              { filterType: 'NOTIONAL', minNotional: '1.5', maxNotional: '200' },
            ],
          },
        ],
      });
      await exchange['loadMarketsImpl']();
      expect(exchange['getMarketLimits']()).toEqual({
        price: { min: 0.1, max: 10 },
        amount: { min: 0.01, max: 5 },
        cost: { min: 1.5, max: 200 },
      });
    });

    it('throws when market information is missing', async () => {
      const exchange = createExchange();
      mainClientMock.getExchangeInfo.mockResolvedValue({ symbols: [] });
      await expect(exchange['loadMarketsImpl']()).rejects.toThrow(
        '[EXCHANGE] Missing market information for BTCUSDT on binance.',
      );
    });
  });

  describe('fetchTickerImpl', () => {
    it.each`
      description         | payload
      ${'single payload'} | ${{ askPrice: '123.4', bidPrice: '120.1' }}
      ${'array payload'}  | ${[{ askPrice: '200', bidPrice: '199.5' }]}
    `('normalizes $description response', async ({ payload }) => {
      const exchange = createExchange();
      mainClientMock.getSymbolOrderBookTicker.mockResolvedValue(payload);
      const ticker = await exchange['fetchTickerImpl']();
      const source = Array.isArray(payload) ? payload[0] : payload;
      expect(ticker).toEqual({ ask: Number(source.askPrice), bid: Number(source.bidPrice) });
    });

    it('throws when ask or bid is missing', async () => {
      const exchange = createExchange();
      mainClientMock.getSymbolOrderBookTicker.mockResolvedValue({ askPrice: 'NaN', bidPrice: '101' });
      await expect(exchange['fetchTickerImpl']()).rejects.toThrow(
        new GekkoError('exchange', 'Missing ask & bid property in payload after calling fetchTicker function.'),
      );
    });
  });

  describe('getKlinesImpl', () => {
    it('requests klines and maps them to candles', async () => {
      const exchange = createExchange();
      const raw = [{ open: 1 }];
      const candles = [{ start: 1 }];
      mainClientMock.getKlines.mockResolvedValue(raw as unknown);
      mapKlinesToCandlesMock.mockReturnValue(candles);
      const result = await exchange['getKlinesImpl'](1000, '5m', 50);
      expect({
        result,
        request: mainClientMock.getKlines.mock.calls[0]?.[0],
        mapperInput: mapKlinesToCandlesMock.mock.calls[0]?.[0],
      }).toEqual({
        result: candles,
        request: { symbol: 'BTCUSDT', interval: '5m', startTime: 1000, limit: 50 },
        mapperInput: raw,
      });
    });
  });

  describe('fetchTradesImpl', () => {
    it('limits and maps public trades', async () => {
      const exchange = createExchange();
      const trades = [{ id: 1 }, { id: 2 }];
      mainClientMock.getRecentTrades.mockResolvedValue(trades as unknown);
      mapPublicTradeToTradeMock.mockImplementation((trade: any) => ({ external: trade.id }));
      const result = await exchange['fetchTradesImpl']();
      expect({
        result,
        request: mainClientMock.getRecentTrades.mock.calls[0]?.[0],
        mapped: mapPublicTradeToTradeMock.mock.calls.map(call => call[0]),
      }).toEqual({
        result: [{ external: 1 }, { external: 2 }],
        request: { symbol: 'BTCUSDT', limit: 1000 },
        mapped: trades,
      });
    });
  });

  describe('fetchMyTradesImpl', () => {
    it('requests account trades with optional start time', async () => {
      const exchange = createExchange();
      const trades = [{ id: 'a' }];
      mainClientMock.getAccountTradeList.mockResolvedValue(trades as unknown);
      mapAccountTradeToTradeMock.mockImplementation((trade: any) => ({ mappedId: trade.id }));
      const result = await exchange['fetchMyTradesImpl'](12);
      expect({
        result,
        request: mainClientMock.getAccountTradeList.mock.calls[0]?.[0],
        mapped: mapAccountTradeToTradeMock.mock.calls[0]?.[0],
      }).toEqual({
        result: [{ mappedId: 'a' }],
        request: { symbol: 'BTCUSDT', startTime: 12, limit: 1000 },
        mapped: trades[0],
      });
    });
  });

  describe('fetchPortfolioImpl', () => {
    it('parses balances for asset and currency', async () => {
      const exchange = createExchange();
      mainClientMock.getAccountInformation.mockResolvedValue({
        balances: [
          { asset: 'BTC', free: '1.5' },
          { asset: 'USDT', free: '200.5' },
        ],
      });
      const portfolio = await exchange['fetchPortfolioImpl']();
      expect(portfolio).toEqual({ asset: 1.5, currency: 200.5 });
    });
  });

  describe('fetchOrderImpl', () => {
    it('fetches and maps spot order', async () => {
      const exchange = createExchange();
      const rawOrder = { id: 91 };
      const mapped = { id: 'mapped' };
      mainClientMock.getOrder.mockResolvedValue(rawOrder as unknown);
      mapSpotOrderToOrderMock.mockReturnValue(mapped);
      const result = await exchange['fetchOrderImpl']('91');
      expect({
        result,
        request: mainClientMock.getOrder.mock.calls[0]?.[0],
        mapperInput: mapSpotOrderToOrderMock.mock.calls[0]?.[0],
      }).toEqual({
        result: mapped,
        request: { symbol: 'BTCUSDT', orderId: 91 },
        mapperInput: rawOrder,
      });
    });
  });

  describe('createLimitOrderImpl', () => {
    it('normalizes and submits limit order', async () => {
      const exchange = createExchange();
      const priceSpy = vi.spyOn(exchange as any, 'checkOrderPrice').mockResolvedValue(275);
      const amountSpy = vi.spyOn(exchange as any, 'checkOrderAmount').mockReturnValue(0.5);
      const costSpy = vi.spyOn(exchange as any, 'checkOrderCost').mockImplementation(() => undefined);
      const mapped = { status: 'ok' };
      mainClientMock.submitNewOrder.mockResolvedValue({ raw: true } as unknown);
      mapSpotOrderToOrderMock.mockReturnValue(mapped);
      const order = await exchange['createLimitOrderImpl']('BUY', 1);
      expect({
        order,
        submitPayload: mainClientMock.submitNewOrder.mock.calls[0]?.[0],
        priceCalls: priceSpy.mock.calls,
        amountCalls: amountSpy.mock.calls,
        costCalls: costSpy.mock.calls.map(call => call.slice(0, 2)),
      }).toEqual({
        order: mapped,
        submitPayload: {
          symbol: 'BTCUSDT',
          side: 'BUY',
          type: 'LIMIT',
          timeInForce: 'GTC',
          quantity: 0.5,
          price: 275,
        },
        priceCalls: [['BUY']],
        amountCalls: [[1]],
        costCalls: [[0.5, 275]],
      });
    });
  });

  describe('createMarketOrderImpl', () => {
    it('submits market order using current ticker', async () => {
      const exchange = createExchange();
      vi.spyOn(exchange, 'fetchTicker').mockResolvedValue({ ask: 120, bid: 115 });
      const amountSpy = vi.spyOn(exchange as any, 'checkOrderAmount').mockReturnValue(0.8);
      const costSpy = vi.spyOn(exchange as any, 'checkOrderCost').mockImplementation(() => undefined);
      const mapped = { id: 'market' };
      mainClientMock.submitNewOrder.mockResolvedValue({ raw: true } as unknown);
      mapSpotOrderToOrderMock.mockReturnValue(mapped);
      const result = await exchange['createMarketOrderImpl']('SELL', 2);
      expect({
        result,
        submitPayload: mainClientMock.submitNewOrder.mock.calls[0]?.[0],
        amountCalls: amountSpy.mock.calls,
        costArgs: costSpy.mock.calls[0],
      }).toEqual({
        result: mapped,
        submitPayload: { symbol: 'BTCUSDT', side: 'SELL', type: 'MARKET', quantity: 0.8 },
        amountCalls: [[2]],
        costArgs: [0.8, 115],
      });
    });
  });

  describe('cancelOrderImpl', () => {
    it('cancels order by identifier', async () => {
      const exchange = createExchange();
      const mapped = { id: 'cancelled' };
      mainClientMock.cancelOrder.mockResolvedValue({ raw: true } as unknown);
      mapSpotOrderToOrderMock.mockReturnValue(mapped);
      const result = await exchange['cancelOrderImpl']('alpha');
      expect({
        result,
        cancelPayload: mainClientMock.cancelOrder.mock.calls[0]?.[0],
        mapperInput: mapSpotOrderToOrderMock.mock.calls[0]?.[0],
      }).toEqual({
        result: mapped,
        cancelPayload: { symbol: 'BTCUSDT', origClientOrderId: 'alpha' },
        mapperInput: { raw: true },
      });
    });
  });

  describe('buildOrderIdentifier', () => {
    it.each`
      id         | expected
      ${'42'}    | ${{ orderId: 42 }}
      ${'42.5'}  | ${{ orderId: 42.5 }}
      ${'alpha'} | ${{ origClientOrderId: 'alpha' }}
      ${'42abc'} | ${{ origClientOrderId: '42abc' }}
    `('buildOrderIdentifier($id) => identifier', ({ id, expected }) => {
      const exchange = createExchange();
      expect(exchange['buildOrderIdentifier'](id)).toEqual(expected);
    });
  });

  describe('transformOrderError', () => {
    it.each`
      code     | expected
      ${-2013} | ${OrderNotFound}
      ${-2011} | ${OrderNotFound}
      ${-2010} | ${InvalidOrder}
      ${-1013} | ${InvalidOrder}
      ${-1011} | ${InvalidOrder}
      ${-1100} | ${InvalidOrder}
      ${-1102} | ${InvalidOrder}
    `('maps binance error code $code', ({ code, expected }) => {
      const exchange = createExchange();
      expect(() => exchange['transformOrderError']({ code, message: 'oops' })).toThrow(expected);
    });

    it('delegates unknown error to toError', () => {
      const exchange = createExchange();
      const delegated = new Error('delegated');
      vi.spyOn(exchange as any, 'toError').mockImplementation(() => delegated);
      expect(() => exchange['transformOrderError']({ code: -1 })).toThrow(delegated);
    });
  });

  describe('toError', () => {
    it('returns existing error instances as-is', () => {
      const exchange = createExchange();
      const err = new Error('boom');
      expect(exchange['toError'](err)).toBe(err);
    });

    it('wraps binance error object in GekkoError', () => {
      const exchange = createExchange();
      const error = exchange['toError']({ code: 1, message: 'fail' });
      expect({ name: error.name, message: error.message }).toEqual({
        name: 'GekkoError',
        message: '[EXCHANGE] fail',
      });
    });

    it('stringifies unknown errors', () => {
      const exchange = createExchange();
      const error = exchange['toError'](Symbol('s'));
      expect({ name: error.name, message: error.message }).toEqual({
        name: 'GekkoError',
        message: '[EXCHANGE] Symbol(s)',
      });
    });
  });

  describe('isRetryableError', () => {
    it.each`
      description               | error                                                | expected
      ${'non axios error'}      | ${{}}                                                | ${false}
      ${'axios without status'} | ${{ isAxiosError: true }}                            | ${true}
      ${'axios 500 error'}      | ${{ isAxiosError: true, response: { status: 502 } }} | ${true}
      ${'axios client error'}   | ${{ isAxiosError: true, response: { status: 400 } }} | ${false}
    `('returns $expected for $description', ({ error, expected }) => {
      const exchange = createExchange();
      expect(exchange['isRetryableError'](error)).toBe(expected);
    });
  });

  describe('type guards and parsers', () => {
    it.each`
      value        | expected
      ${undefined} | ${undefined}
      ${null}      | ${undefined}
      ${'42'}      | ${42}
      ${42}        | ${42}
      ${'42.1'}    | ${42.1}
      ${'foo'}     | ${undefined}
      ${NaN}       | ${undefined}
    `('parseNumber($value) => $expected', ({ value, expected }) => {
      const exchange = createExchange();
      expect(exchange['parseNumber'](value)).toBe(expected);
    });

    it.each`
      value        | expected
      ${'10'}      | ${10}
      ${0}         | ${undefined}
      ${'0'}       | ${undefined}
      ${undefined} | ${undefined}
    `('parseMax($value) => $expected', ({ value, expected }) => {
      const exchange = createExchange();
      expect(exchange['parseMax'](value)).toBe(expected);
    });

    it.each`
      value            | expected
      ${{}}            | ${false}
      ${{ code: 1 }}   | ${true}
      ${{ code: '1' }} | ${false}
    `('isBinanceError($value) => $expected', ({ value, expected }) => {
      const exchange = createExchange();
      expect(exchange['isBinanceError'](value)).toBe(expected);
    });

    it.each`
      value                      | expected
      ${undefined}               | ${false}
      ${{}}                      | ${false}
      ${{ isAxiosError: true }}  | ${true}
      ${{ isAxiosError: false }} | ${false}
    `('isAxiosError($value) => $expected', ({ value, expected }) => {
      const exchange = createExchange();
      expect(exchange['isAxiosError'](value)).toBe(expected);
    });
  });
});
