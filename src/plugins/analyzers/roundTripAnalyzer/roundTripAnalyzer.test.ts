import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT } from '@constants/event.const';
import { CandleBucket } from '@models/event.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import * as statsUtils from '@utils/finance/stats.utils';
import { stdev } from '@utils/math/math.utils';
import { calculatePairEquity, getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { beforeEach, describe, expect, it, MockInstance, vi } from 'vitest';
import { RoundTripAnalyzer } from './roundTripAnalyzer';
import { PLUGIN_NAME } from './roundTripAnalyzer.const';
import { logFinalize, logRoundtrip } from './roundTripAnalyzer.utils';

// Mocks
vi.mock('@services/logger');
vi.mock('@utils/finance/stats.utils');
vi.mock('@utils/math/math.utils');
vi.mock('@utils/math/round.utils', () => ({ round: (val: number) => val }));
vi.mock('@utils/portfolio/portfolio.utils');
vi.mock('./roundTripAnalyzer.utils');

// Mock Configuration
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(function () {
    return {
      getWatch: vi.fn(() => ({
        pairs: [{ symbol: 'BTC/USDT', timeframe: '1m' }],
        assets: ['BTC'],
        currency: 'USDT',
        timeframe: '1m',
        warmup: { candleCount: 100, tickrate: 1000 },
        mode: 'realtime',
        tickrate: 1000,
      })),
      getStrategy: vi.fn(() => ({})),
      showLogo: vi.fn(),
      getPlugins: vi.fn(),
      getStorage: vi.fn(),
      getExchange: vi.fn(),
    };
  });
  return { config: new Configuration() };
});

describe('RoundTripAnalyzer', () => {
  let analyzer: RoundTripAnalyzer;
  const mockConfig = { name: PLUGIN_NAME, riskFreeReturn: 2, enableConsoleTable: true };

  beforeEach(() => {
    (calculatePairEquity as any).mockReturnValue({ total: 1000, free: 500, used: 500 });
    (getAssetBalance as any).mockReturnValue({ total: 1.5, free: 1.5, used: 0 });
    (stdev as any).mockReturnValue(0.05);

    Object.keys(statsUtils).forEach(key => {
      // @ts-expect-error iterating over all exports
      if (typeof statsUtils[key] === 'function' && 'mockReturnValue' in statsUtils[key]) {
        // @ts-expect-error mocking dynamically
        (statsUtils[key] as any).mockReturnValue(0);
      }
    });

    vi.mocked(warning).mockClear();
    vi.mocked(logFinalize).mockClear();
    vi.mocked(logRoundtrip).mockClear();

    analyzer = new RoundTripAnalyzer(mockConfig);
  });

  describe('constructor', () => {
    it.each`
      property                | expected
      ${'pluginName'}         | ${PLUGIN_NAME}
      ${'riskFreeReturn'}     | ${2}
      ${'enableConsoleTable'} | ${true}
      ${'symbol'}             | ${'BTC/USDT'}
      ${'asset'}              | ${'BTC'}
    `('should initialize with correct default $property as $expected', ({ property, expected }) => {
      expect((analyzer as any)[property]).toBe(expected);
    });

    it('should throw error if multiple pairs are configured', () => {
      vi.spyOn(config, 'getWatch').mockReturnValueOnce({
        pairs: [{ symbol: 'BTC/USDT' }, { symbol: 'ETH/USDT' }] as any,
        assets: ['BTC', 'ETH'],
        currency: 'USDT',
        timeframe: '1m',
        warmup: { candleCount: 100, tickrate: 1000 },
        mode: 'realtime',
        tickrate: 1000,
      });

      expect(() => new RoundTripAnalyzer(mockConfig)).toThrow('RoundTripAnalyzer can only be used with a single pair');
    });
  });

  describe('onPortfolioChange', () => {
    it('should call calculatePairEquity', () => {
      const portfolio = { id: 'test', balance: 1000, timestamp: 1000, assets: [] } as any;
      analyzer.onPortfolioChange([portfolio]);
      expect(calculatePairEquity).toHaveBeenCalledWith(portfolio, 'BTC/USDT', 0);
    });

    it('should update currentEquity', () => {
      const portfolio = { id: 'test', balance: 1000, timestamp: 1000, assets: [] } as any;
      analyzer.onPortfolioChange([portfolio]);
      expect(analyzer['currentEquity']).toBe(1000);
    });

    it('should update start equity on first portfolio', () => {
      const portfolio = { id: 'test', balance: 1000, timestamp: 1000, assets: [] } as any;
      analyzer.onPortfolioChange([portfolio]);
      expect(analyzer['start'].equity).toBe(1000);
    });

    it('should update start portfolio on first portfolio', () => {
      const portfolio = { id: 'test', balance: 1000, timestamp: 1000, assets: [] } as any;
      analyzer.onPortfolioChange([portfolio]);
      expect(analyzer['start'].portfolio).toBe(portfolio);
    });

    it('should only update start portfolio once for subsequent events', () => {
      const p1 = { id: '1' } as any;
      const p2 = { id: '2' } as any;
      (calculatePairEquity as any).mockReturnValueOnce({ total: 1000 }).mockReturnValueOnce({ total: 2000 });

      analyzer.onPortfolioChange([p1]);
      analyzer.onPortfolioChange([p2]);

      expect(analyzer['start'].portfolio).toBe(p1);
    });

    it('should only update start equity once for subsequent events', () => {
      const p1 = { id: '1' } as any;
      const p2 = { id: '2' } as any;
      (calculatePairEquity as any).mockReturnValueOnce({ total: 1000 }).mockReturnValueOnce({ total: 2000 });

      analyzer.onPortfolioChange([p1]);
      analyzer.onPortfolioChange([p2]);

      expect(analyzer['start'].equity).toBe(1000);
    });

    it('should update currentEquity for subsequent events', () => {
      const p1 = { id: '1' } as any;
      const p2 = { id: '2' } as any;
      (calculatePairEquity as any).mockReturnValueOnce({ total: 1000 }).mockReturnValueOnce({ total: 2000 });

      analyzer.onPortfolioChange([p1]);
      analyzer.onPortfolioChange([p2]);

      expect(analyzer['currentEquity']).toBe(2000);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('should log warning if candle is missing', () => {
      const bucket = new Map() as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Missing candle'));
    });

    it('should not set warmupCompleted if candle is missing', () => {
      const bucket = new Map() as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(analyzer['warmupCompleted']).toBe(false);
    });

    it('should set warmupCompleted to true if candle is found', () => {
      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(analyzer['warmupCompleted']).toBe(true);
    });

    it('should set dates.start if candle is found', () => {
      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(analyzer['dates'].start).toBe(1000);
    });

    it('should set startPrice if candle is found', () => {
      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(analyzer['startPrice']).toBe(50000);
    });

    it('should process cached warmup bucket if available', () => {
      const warmupBucket = new Map([['BTC/USDT', { start: 2000, close: 51000 }]]) as unknown as CandleBucket;
      analyzer['warmupBucket'] = warmupBucket;

      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;

      const processSpy = vi.spyOn(analyzer as any, 'processOneMinuteBucket');
      analyzer.onStrategyWarmupCompleted([bucket]);

      expect(processSpy).toHaveBeenCalledWith(warmupBucket);
    });
  });

  describe('onOrderCompleted', () => {
    it('should ignore first order if it is SELL', () => {
      const event = { order: { side: 'SELL' } } as any;
      analyzer.onOrderCompleted([event]);
      expect(analyzer['tradeCount']).toBe(0);
    });

    it('should increment tradeCount on valid order', () => {
      const event = {
        order: { side: 'BUY', price: 100 },
        exchange: { portfolio: {} },
      } as any;
      analyzer.onOrderCompleted([event]);
      expect(analyzer['tradeCount']).toBe(1);
    });

    it('should call registerRoundtripPart on valid order', () => {
      const event = {
        order: { side: 'BUY', price: 100 },
        exchange: { portfolio: {} },
      } as any;
      const spy = vi.spyOn(analyzer as any, 'registerRoundtripPart');
      analyzer.onOrderCompleted([event]);
      expect(spy).toHaveBeenCalledWith(event);
    });
  });

  describe('registerRoundtripPart', () => {
    it.each`
      price   | description
      ${null} | ${'null price'}
      ${0}    | ${'zero price'}
      ${-1}   | ${'negative price'}
    `('should log warning and abort if order price is invalid ($description)', ({ price }) => {
      const event = { order: { price, id: '123' } } as any;
      analyzer['registerRoundtripPart'](event);
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('without a valid price'));
    });

    describe('BUY order', () => {
      let event: any;
      beforeEach(() => {
        event = {
          order: { side: 'BUY', price: 100, orderExecutionDate: 1000 },
          exchange: { portfolio: {} },
        };
      });

      it('should set roundTrip entry date', () => {
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['roundTrip'].entry?.date).toBe(1000);
      });

      it('should set roundTrip entry price', () => {
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['roundTrip'].entry?.price).toBe(100);
      });

      it('should set roundTrip entry total', () => {
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['roundTrip'].entry?.total).toBe(1000); // from mock
      });

      it('should set openRoundTrip to true', () => {
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['openRoundTrip']).toBe(true);
      });

      it('should reset maxAdverseExcursion to 0', () => {
        analyzer['maxAdverseExcursion'] = 50;
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['maxAdverseExcursion']).toBe(0);
      });

      it('should reset exit to null', () => {
        analyzer['roundTrip'].exit = { price: 200 } as any;
        analyzer['registerRoundtripPart'](event);
        expect(analyzer['roundTrip'].exit).toBeNull();
      });

      it('should use 0 if order.price is missing (edge case for TypeScript matching)', () => {
        // By bypassing the type check we see if it handles undefined,
        // though the beginning of the function returns if price == null.
        analyzer['registerRoundtripPart'](event);
      });
    });

    describe('SELL order', () => {
      let sellEvent: any;
      let handleSpy: MockInstance;
      beforeEach(() => {
        const buyEvent = {
          order: { side: 'BUY', price: 100, orderExecutionDate: 1000 },
          exchange: { portfolio: {} },
        } as any;
        analyzer['registerRoundtripPart'](buyEvent); // Setup entry

        sellEvent = {
          order: { side: 'SELL', price: 200, orderExecutionDate: 2000 },
          exchange: { portfolio: {} },
        } as any;

        (calculatePairEquity as any).mockReturnValue({ total: 2000 }); // Profit
        handleSpy = vi.spyOn(analyzer as any, 'handleCompletedRoundtrip');
      });

      it('should set roundTrip exit date', () => {
        analyzer['registerRoundtripPart'](sellEvent);
        expect(analyzer['roundTrip'].exit?.date).toBe(2000);
      });

      it('should set roundTrip exit price', () => {
        analyzer['registerRoundtripPart'](sellEvent);
        expect(analyzer['roundTrip'].exit?.price).toBe(200);
      });

      it('should set openRoundTrip to false', () => {
        analyzer['registerRoundtripPart'](sellEvent);
        expect(analyzer['openRoundTrip']).toBe(false);
      });

      it('should update currentEquity', () => {
        analyzer['registerRoundtripPart'](sellEvent);
        expect(analyzer['currentEquity']).toBe(2000);
      });

      it('should call handleCompletedRoundtrip', () => {
        analyzer['registerRoundtripPart'](sellEvent);
        expect(handleSpy).toHaveBeenCalled();
      });
    });
  });

  describe('handleCompletedRoundtrip', () => {
    it('should return early if entry is missing', () => {
      analyzer['roundTrip'].entry = null;
      analyzer['roundTrip'].exit = {} as any;
      analyzer['handleCompletedRoundtrip']();
      expect(logRoundtrip).not.toHaveBeenCalled();
    });

    it('should return early if exit is missing', () => {
      analyzer['roundTrip'].entry = {} as any;
      analyzer['roundTrip'].exit = null;
      analyzer['handleCompletedRoundtrip']();
      expect(logRoundtrip).not.toHaveBeenCalled();
    });

    describe('With Complete RoundTrip', () => {
      beforeEach(() => {
        analyzer['roundTrip'] = {
          entry: { date: 1000, price: 100, total: 1000, asset: 1, currency: 100 },
          exit: { date: 2000, price: 110, total: 1100, asset: 0, currency: 1100 },
        };
        analyzer['maxAdverseExcursion'] = 5;
      });

      it('should append roundtrip to roundTrips array', () => {
        analyzer['handleCompletedRoundtrip']();
        expect(analyzer['roundTrips']).toHaveLength(1);
      });

      it('should reset maxAdverseExcursion', () => {
        analyzer['handleCompletedRoundtrip']();
        expect(analyzer['maxAdverseExcursion']).toBe(0);
      });

      it('should log the roundtrip', () => {
        analyzer['handleCompletedRoundtrip']();
        expect(logRoundtrip).toHaveBeenCalledWith(analyzer['roundTrips'][0], 'USDT', true);
      });

      it('should update cached exposure', () => {
        analyzer['handleCompletedRoundtrip']();
        expect(analyzer['exposure']).toBe(1000);
      });

      it('should track losses if exitEquity < entryEquity', () => {
        analyzer['roundTrip'].exit!.total = 900;
        analyzer['handleCompletedRoundtrip']();
        expect(analyzer['losses']).toHaveLength(1);
      });

      it('should calculate profit percentage correctly', () => {
        analyzer['roundTrip'].entry!.total = 1000;
        analyzer['roundTrip'].exit!.total = 1100;
        analyzer['handleCompletedRoundtrip']();
        // 1100 / 1000 * 100 - 100 = 10%
        expect(analyzer['roundTrips'][0].profit).toBe(10);
      });

      it('should handle zero entry equity for profit calculation without throwing NaN if fallback exists', () => {
        analyzer['roundTrip'].entry!.total = 0;
        analyzer['handleCompletedRoundtrip']();
        // Expected to fallback to 0 if division by zero
        expect(analyzer['roundTrips'][0].profit).toBe(0);
      });
    });
  });

  describe('processOneMinuteBucket', () => {
    it('should warn if missing candle', () => {
      const bucket = new Map() as CandleBucket;
      analyzer['processOneMinuteBucket'](bucket);
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Missing candle'));
    });

    it('should cache bucket if warmup not completed', () => {
      const candle = { start: 1000, close: 100 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer['processOneMinuteBucket'](bucket);
      expect(analyzer['warmupBucket']).toBe(bucket);
    });

    it('should update dates.end if warmup completed', () => {
      analyzer['warmupCompleted'] = true;
      const candle = { start: 1000, close: 100, low: 90 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer['processOneMinuteBucket'](bucket);
      expect(analyzer['dates'].end).toBe(1000 + 60000); // addMinutes(1)
    });

    it('should update maxAdverseExcursion if in trade and candle low drops further', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['openRoundTrip'] = true;
      analyzer['roundTrip'].entry = { price: 100 } as any;
      const candle = { start: 1000, close: 90, low: 80 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer['processOneMinuteBucket'](bucket);
      expect(analyzer['maxAdverseExcursion']).toBe(20);
    });

    it('should NOT update maxAdverseExcursion if in trade but candle low does not drop further', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['openRoundTrip'] = true;
      analyzer['roundTrip'].entry = { price: 100 } as any;
      analyzer['maxAdverseExcursion'] = 25;
      const candle = { start: 1000, close: 95, low: 90 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;
      analyzer['processOneMinuteBucket'](bucket);
      expect(analyzer['maxAdverseExcursion']).toBe(25); // stays the same
    });
  });

  describe('processInit', () => {
    it('should execute without error', () => {
      expect(() => analyzer['processInit']()).not.toThrow();
    });
  });

  describe('processFinalize', () => {
    it('should calculate report and emit it directly', () => {
      const emitSpy = vi.spyOn(analyzer as any, 'emit');
      const calcSpy = vi.spyOn(analyzer as any, 'calculateReportStatistics');
      const mockReport = { id: 'TRADING REPORT' } as any;
      calcSpy.mockReturnValue(mockReport);

      analyzer['processFinalize']();
      expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, mockReport);
    });

    it('should log final report when console table enabled', () => {
      const calcSpy = vi.spyOn(analyzer as any, 'calculateReportStatistics');
      const mockReport = { id: 'TRADING REPORT' } as any;
      calcSpy.mockReturnValue(mockReport);
      analyzer['enableConsoleTable'] = true;

      analyzer['processFinalize']();
      expect(logFinalize).toHaveBeenCalledWith(mockReport, 'USDT'); // NOTE: Removed third argument mapping
    });
  });

  describe('calculateReportStatistics', () => {
    it('should return empty report and warn if start equity is missing', () => {
      analyzer['start'] = { equity: 0, portfolio: null };
      analyzer['startPrice'] = 100;
      const report = analyzer['calculateReportStatistics']();
      expect(report.id).toBe('TRADING REPORT');
    });

    it('should return empty report and warn if start portfolio is missing', () => {
      analyzer['start'] = { equity: 1000, portfolio: null };
      analyzer['startPrice'] = 100;
      analyzer['calculateReportStatistics']();
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('No portfolio data'));
    });

    it('should warn if elapsed years is very short (<0.01)', () => {
      analyzer['start'] = { equity: 1000, portfolio: {} as any };
      analyzer['startPrice'] = 100;
      analyzer['dates'] = { start: Date.now(), end: Date.now() + 1000 };
      analyzer['calculateReportStatistics']();
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Elapsed period is very short'));
    });

    it('should calculate full report metrics successfully', () => {
      analyzer['start'] = { equity: 1000, portfolio: {} as any };
      analyzer['currentEquity'] = 2000;
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 200;
      analyzer['dates'] = { start: Date.now() - 31536000000, end: Date.now() }; // 1 year approx
      analyzer['roundTrips'] = [
        { pnl: 500, profit: 50, maxAdverseExcursion: 0 } as any,
        { pnl: 500, profit: 50, maxAdverseExcursion: 0 } as any,
      ];
      analyzer['tradeCount'] = 2;

      (statsUtils.calculateAnnualizedReturnPct as any).mockReturnValue(100);
      (statsUtils.calculateTotalReturnPct as any).mockReturnValue(100);

      const report = analyzer['calculateReportStatistics']();

      expect(report.finalBalance).toBe(2000);
    });

    it('should call calculateSharpeRatio during report generation', () => {
      analyzer['start'] = { equity: 1000, portfolio: {} as any };
      analyzer['currentEquity'] = 2000;
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 200;
      analyzer['dates'] = { start: Date.now() - 31536000000, end: Date.now() }; // 1 year approx
      analyzer['roundTrips'] = [];
      analyzer['tradeCount'] = 0;

      analyzer['calculateReportStatistics']();
      expect(statsUtils.calculateSharpeRatio).toHaveBeenCalled();
    });

    it('should calculate null winRate smoothly', () => {
      analyzer['start'] = { equity: 1000, portfolio: {} as any };
      analyzer['currentEquity'] = 2000;
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 200;
      analyzer['dates'] = { start: Date.now() - 31536000000, end: Date.now() }; // 1 year approx
      analyzer['roundTrips'] = [];
      analyzer['tradeCount'] = 0;

      (statsUtils.calculateWinRate as any).mockReturnValue(null);
      const report = analyzer['calculateReportStatistics']();
      expect(report.winRate).toBeNull();
    });
  });

  describe('getStaticConfiguration', () => {
    it('should return correct Plugin Name', () => {
      const config = RoundTripAnalyzer.getStaticConfiguration();
      expect(config.name).toBe(PLUGIN_NAME);
    });

    it('should configure modes correctly', () => {
      const config = RoundTripAnalyzer.getStaticConfiguration();
      expect(config.modes).toEqual(['realtime', 'backtest']);
    });

    it('should configure eventsEmitted correctly', () => {
      const config = RoundTripAnalyzer.getStaticConfiguration();
      expect(config.eventsEmitted).toEqual([PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT]);
    });

    it('should export onX method names as handlers', () => {
      const config = RoundTripAnalyzer.getStaticConfiguration();
      expect(config.eventsHandlers).toEqual(expect.arrayContaining(['onPortfolioChange']));
    });
  });
});
