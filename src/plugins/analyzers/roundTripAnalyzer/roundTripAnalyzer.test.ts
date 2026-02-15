import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT } from '@constants/event.const';
import { CandleBucket } from '@models/event.types';
import { config } from '@services/configuration/configuration';
import { warning } from '@services/logger';
import * as statsUtils from '@utils/finance/stats.utils';
import { stdev } from '@utils/math/math.utils';
import { calculatePairEquity, getAssetBalance } from '@utils/portfolio/portfolio.utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    // Default mock implementations
    (calculatePairEquity as any).mockReturnValue({ total: 1000, free: 500, used: 500 });
    (getAssetBalance as any).mockReturnValue({ total: 1.5, free: 1.5, used: 0 });
    (stdev as any).mockReturnValue(0.05);

    // Stats defaults
    Object.keys(statsUtils).forEach(key => {
      // @ts-expect-error iterating over all exports
      if (typeof statsUtils[key] === 'function' && 'mockReturnValue' in statsUtils[key]) {
        // @ts-expect-error mocking dynamically
        statsUtils[key].mockReturnValue(0);
      }
    });

    analyzer = new RoundTripAnalyzer(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with correct defaults', () => {
      expect(analyzer['pluginName']).toBe(PLUGIN_NAME);
      expect(analyzer['riskFreeReturn']).toBe(2);
      expect(analyzer['enableConsoleTable']).toBe(true);
      expect(analyzer['symbol']).toBe('BTC/USDT');
      expect(analyzer['asset']).toBe('BTC');
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
    it('should update currentEquity and start values', () => {
      const portfolio = {
        id: 'test',
        balance: 1000,
        timestamp: 1000,
        assets: [],
      } as any;

      const payloads = [portfolio];

      analyzer.onPortfolioChange(payloads);

      expect(calculatePairEquity).toHaveBeenCalledWith(portfolio, 'BTC/USDT', 0); // lastPriceUpdate is 0 initially
      expect(analyzer['currentEquity']).toBe(1000);
      expect(analyzer['start'].equity).toBe(1000);
      expect(analyzer['start'].portfolio).toBe(portfolio);
    });

    it('should only update start values once', () => {
      const p1 = { id: '1' } as any;
      const p2 = { id: '2' } as any;

      (calculatePairEquity as any).mockReturnValueOnce({ total: 1000 }).mockReturnValueOnce({ total: 2000 });

      analyzer.onPortfolioChange([p1]);
      expect(analyzer['start'].portfolio).toBe(p1);
      expect(analyzer['start'].equity).toBe(1000);

      analyzer.onPortfolioChange([p2]);
      expect(analyzer['start'].portfolio).toBe(p1); // Should still be p1
      expect(analyzer['start'].equity).toBe(1000); // Should still be 1000
      expect(analyzer['currentEquity']).toBe(2000);
    });
  });

  describe('onStrategyWarmupCompleted', () => {
    it('should log warning if candle is missing', () => {
      const bucket = new Map() as CandleBucket;
      analyzer.onStrategyWarmupCompleted([bucket]);
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Missing candle'));
      expect(analyzer['warmupCompleted']).toBe(false);
    });

    it('should set warmupCompleted and start date', () => {
      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;

      analyzer.onStrategyWarmupCompleted([bucket]);

      expect(analyzer['warmupCompleted']).toBe(true);
      expect(analyzer['dates'].start).toBe(1000);
      expect(analyzer['startPrice']).toBe(50000);
    });

    it('should process cached warmup bucket if available', () => {
      const warmupBucket = new Map([['BTC/USDT', { start: 2000, close: 51000 }]]) as unknown as CandleBucket;
      analyzer['warmupBucket'] = warmupBucket;

      const candle = { start: 1000, close: 50000 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;

      // Spy on processOneMinuteBucket
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

    it('should process order and increment tradeCount', () => {
      const event = {
        order: { side: 'BUY', price: 100 },
        exchange: { portfolio: {} },
      } as any;

      const spy = vi.spyOn(analyzer as any, 'registerRoundtripPart');

      analyzer.onOrderCompleted([event]);

      expect(analyzer['tradeCount']).toBe(1);
      expect(spy).toHaveBeenCalledWith(event);
    });
  });

  describe('registerRoundtripPart', () => {
    it('should return warnings if order price is invalid', () => {
      const event = { order: { price: null, id: '123' } } as any;
      analyzer['registerRoundtripPart'](event);
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('without a valid price'));
    });

    it('should set roundTrip entry on BUY', () => {
      const event = {
        order: { side: 'BUY', price: 100, orderExecutionDate: 1000 },
        exchange: { portfolio: {} }, // Mocked getAssetBalance/calculatePairEquity handles this
      } as any;

      analyzer['registerRoundtripPart'](event);

      expect(analyzer['roundTrip'].entry).toEqual({
        date: 1000,
        price: 100,
        total: 1000, // from calculatePairEquity mock
        asset: 1.5, // from getAssetBalance mock
        currency: 1.5, // from getAssetBalance mock
      });
      expect(analyzer['openRoundTrip']).toBe(true);
      expect(analyzer['maxAdverseExcursion']).toBe(0);
      expect(analyzer['roundTrip'].exit).toBeNull();
    });

    it('should set roundTrip exit on SELL and complete roundtrip', () => {
      const buyEvent = {
        order: { side: 'BUY', price: 100, orderExecutionDate: 1000 },
        exchange: { portfolio: {} },
      } as any;
      analyzer['registerRoundtripPart'](buyEvent); // Setup entry

      const sellEvent = {
        order: { side: 'SELL', price: 200, orderExecutionDate: 2000 },
        exchange: { portfolio: {} },
      } as any;

      const handleSpy = vi.spyOn(analyzer as any, 'handleCompletedRoundtrip');

      (calculatePairEquity as any).mockReturnValue({ total: 2000 }); // Profit

      analyzer['registerRoundtripPart'](sellEvent);

      expect(analyzer['roundTrip'].exit).toEqual({
        date: 2000,
        price: 200,
        total: 2000,
        asset: 1.5,
        currency: 1.5,
      });
      expect(analyzer['openRoundTrip']).toBe(false);
      expect(analyzer['currentEquity']).toBe(2000);
      expect(handleSpy).toHaveBeenCalled();
    });
  });

  describe('handleCompletedRoundtrip', () => {
    it('should return early if entry or exit is missing', () => {
      analyzer['handleCompletedRoundtrip']();
      expect(logRoundtrip).not.toHaveBeenCalled();
    });

    it('should process completed roundtrip', () => {
      analyzer['roundTrip'] = {
        entry: { date: 1000, price: 100, total: 1000, asset: 1, currency: 100 },
        exit: { date: 2000, price: 110, total: 1100, asset: 0, currency: 1100 },
      };
      analyzer['maxAdverseExcursion'] = 5;

      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['roundTrips']).toHaveLength(1);
      const rt = analyzer['roundTrips'][0];
      expect(rt).toEqual(
        expect.objectContaining({
          entryAt: 1000,
          exitAt: 2000,
          pnl: 100,
          profit: 10,
          maxAdverseExcursion: 5,
          duration: 1000,
        }),
      );
      expect(analyzer['maxAdverseExcursion']).toBe(0);
      expect(logRoundtrip).toHaveBeenCalledWith(rt, 'USDT', true); // Currency is 'USDT' from symbol
      expect(analyzer['exposure']).toBe(1000);
    });

    it('should track losses', () => {
      analyzer['roundTrip'] = {
        entry: { date: 1000, price: 100, total: 1000, asset: 1, currency: 100 },
        exit: { date: 2000, price: 90, total: 900, asset: 0, currency: 900 },
      };

      analyzer['handleCompletedRoundtrip']();
      expect(analyzer['losses']).toHaveLength(1);
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
      expect(analyzer['lastPriceUpdate']).toBe(100);
    });

    it('should update stats if warmup completed', () => {
      analyzer['warmupCompleted'] = true;
      const candle = { start: 1000, close: 100, low: 90 } as any; // low 90
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;

      analyzer['processOneMinuteBucket'](bucket);

      expect(analyzer['dates'].end).toBe(1000 + 60000); // addMinutes(1)
      expect(analyzer['endPrice']).toBe(100);
    });

    it('should update maxAdverseExcursion if in trade', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['openRoundTrip'] = true;
      analyzer['roundTrip'].entry = { price: 100 } as any; // Entry 100

      // Candle low 80 -> (100-80)/100 = 20% drop
      const candle = { start: 1000, close: 90, low: 80 } as any;
      const bucket = new Map([['BTC/USDT', candle]]) as CandleBucket;

      analyzer['processOneMinuteBucket'](bucket);

      expect(analyzer['maxAdverseExcursion']).toBe(20);
    });
  });

  describe('processInit', () => {
    it('should execute without error', () => {
      expect(() => analyzer['processInit']()).not.toThrow();
    });
  });

  describe('processFinalize', () => {
    it('should calculate report and emit it', () => {
      const emitSpy = vi.spyOn(analyzer as any, 'emit');
      const calcSpy = vi.spyOn(analyzer as any, 'calculateReportStatistics');

      const mockReport = { id: 'TRADING REPORT' } as any;
      calcSpy.mockReturnValue(mockReport);

      analyzer['processFinalize']();

      expect(calcSpy).toHaveBeenCalled();
      expect(logFinalize).toHaveBeenCalledWith(mockReport, 'USDT', true);
      expect(emitSpy).toHaveBeenCalledWith(PERFORMANCE_REPORT_EVENT, mockReport);
    });
  });

  describe('calculateReportStatistics', () => {
    it('should return empty report if no portfolio data', () => {
      analyzer['start'] = { equity: 0, portfolio: null };
      const report = analyzer['calculateReportStatistics']();
      expect(report.id).toBe('TRADING REPORT');
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('No portfolio data'));
    });

    it('should calculate full report', () => {
      // Setup state
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

      // Mock external calcs return values
      (statsUtils.calculateAnnualizedReturnPct as any).mockReturnValue(100);
      (statsUtils.calculateTotalReturnPct as any).mockReturnValue(100);

      const report = analyzer['calculateReportStatistics']();

      expect(report.finalBalance).toBe(2000);
      expect(report.netProfit).toBe(1000);
      expect(report.tradeCount).toBe(2);
      expect(report.annualizedReturnPct).toBe(100);

      expect(statsUtils.calculateSharpeRatio).toHaveBeenCalled();
    });

    it('should warn if elapsed years is very short', () => {
      analyzer['start'] = { equity: 1000, portfolio: {} as any };
      analyzer['dates'] = { start: Date.now(), end: Date.now() + 1000 };
      analyzer['calculateReportStatistics']();
      expect(warning).toHaveBeenCalledWith('roundtrip analyzer', expect.stringContaining('Elapsed period is very short'));
    });
  });

  describe('getStaticConfiguration', () => {
    it('should return static config', () => {
      const config = RoundTripAnalyzer.getStaticConfiguration();
      expect(config.name).toBe(PLUGIN_NAME);
      expect(config.modes).toEqual(['realtime', 'backtest']);
      expect(config.eventsEmitted).toEqual([PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT]);
    });
  });
});
