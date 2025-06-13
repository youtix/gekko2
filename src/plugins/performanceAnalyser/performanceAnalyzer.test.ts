import { first, isNil } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { PerformanceAnalyzer } from './performanceAnalyzer';
import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_EVENT, ROUNDTRIP_UPDATE_EVENT } from './performanceAnalyzer.const';

vi.mock('./performanceAnalyzer.utils');
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({})),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('PerformanceAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer({ name: 'PerformanceAnalyzer', riskFreeReturn: 5, enableConsoleTable: false });
    analyzer.deferredEmit = () => {};
    analyzer.emit = () => {};
  });

  describe('onPortfolioValueChange', () => {
    it('should set balance on each protfolio change', () => {
      analyzer.onPortfolioValueChange({ balance: 1000 });
      expect(analyzer.balance).toBe(1000);
    });
    it('should set start balance for the first time', () => {
      analyzer.onPortfolioValueChange({ balance: 2000 });
      expect(analyzer.start.balance).toBe(2000);
    });
    it('should NOT set start balance when already set', () => {
      analyzer.start.balance = 1000;
      analyzer.onPortfolioValueChange({ balance: 2000 });
      expect(analyzer.start.balance).toBe(1000);
    });
    it.each`
      initBalance  | eventBalance | expectedStartBalance | expectedBalance
      ${undefined} | ${1000}      | ${1000}              | ${1000}
      ${500}       | ${1500}      | ${500}               | ${1500}
    `(
      'sets start.balance and balance correctly when initBalance is $initBalance and event.balance is $eventBalance',
      ({ initBalance, eventBalance, expectedStartBalance, expectedBalance }) => {
        if (!isNil(initBalance)) {
          analyzer.start.balance = initBalance;
        }
        analyzer.onPortfolioValueChange({ balance: eventBalance });
        expect(analyzer.start.balance).toBe(expectedStartBalance);
        expect(analyzer.balance).toBe(expectedBalance);
      },
    );
  });
  describe('onPortfolioChange', () => {
    it('should set start.portfolio if NOT already set', () => {
      const portfolioEvent = { balance: 1000 };
      analyzer.onPortfolioChange(portfolioEvent);
      expect(analyzer.start.portfolio).toEqual(portfolioEvent);
    });
    it('should NOT set start.portfolio if already set', () => {
      analyzer.start.portfolio = 2000;
      const portfolioEvent = { balance: 1000 };
      analyzer.onPortfolioChange(portfolioEvent);
      expect(analyzer.start.portfolio).toEqual(2000);
    });
  });
  describe('onStrategyWarmupCompleted', () => {
    it('should set warmup completed to true', () => {
      analyzer.onStrategyWarmupCompleted();
      expect(analyzer.warmupCompleted).toBeTruthy();
    });
    it('should call processCandle if warmup candle is set', () => {
      const processCandleSpy = vi.spyOn(analyzer, 'processCandle');
      analyzer.warmupCandle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.onStrategyWarmupCompleted();
      expect(processCandleSpy).toHaveBeenCalledOnce();
    });
    it('should NOT call processCandle if warmup candle is missing', () => {
      const processCandleSpy = vi.spyOn(analyzer, 'processCandle');
      analyzer.onStrategyWarmupCompleted();
      expect(processCandleSpy).not.toHaveBeenCalled();
    });
  });
  describe('onTradeCompleted', () => {
    it('should increment trades', () => {
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, blance: 1000 };
      analyzer.onTradeCompleted(tradeEvent);
      expect(analyzer.trades).toBe(1);
    });
    it('should update portfolio', () => {
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, balance: 1000 };
      analyzer.onTradeCompleted(tradeEvent);
      expect(analyzer.portfolio).toBe(tradeEvent.portfolio);
    });
    it('should update balance', () => {
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, balance: 1000 };
      analyzer.onTradeCompleted(tradeEvent);
      expect(analyzer.balance).toBe(tradeEvent.balance);
    });
    it.todo('should call calculateReportStatistics when option is enable', () => {
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, balance: 1000 };
      const calculateReportStatisticsSpy = vi.spyOn(analyzer, 'calculateReportStatistics').mockReturnValue(undefined);
      analyzer.onTradeCompleted(tradeEvent);
      expect(calculateReportStatisticsSpy).toHaveBeenCalledOnce();
    });
    it.todo('should emit an intermediate report event when option is enable', () => {
      // TODO: Enable option here
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, balance: 1000 };
      vi.spyOn(analyzer, 'calculateReportStatistics').mockReturnValue({ label: 'REPORT' });
      const deferredEmitSpy = vi.spyOn(analyzer, 'deferredEmit');
      analyzer.onTradeCompleted(tradeEvent);
      expect(deferredEmitSpy).toHaveBeenCalledOnce();
      expect(deferredEmitSpy).toHaveBeenCalledExactlyOnceWith(PERFORMANCE_REPORT_EVENT, {
        label: 'REPORT',
      });
    });
    it('should NOT emit when report is NOT generated', () => {
      const tradeEvent = { portfolio: { asset: 100, currency: 200 }, balance: 1000 };
      vi.spyOn(analyzer, 'calculateReportStatistics').mockReturnValue(undefined);
      const deferredEmitSpy = vi.spyOn(analyzer, 'deferredEmit');
      analyzer.onTradeCompleted(tradeEvent);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
  });
  describe('processCandle', () => {
    it('should update warmup candle when performance analyzer is warming up', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = false;
      analyzer.processCandle(candle);
      expect(analyzer.warmupCandle).toBe(candle);
    });
    it('should update price when warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.processCandle(candle);
      expect(analyzer.price).toBe(candle.close);
    });
    it('should update end price when warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.processCandle(candle);
      expect(analyzer.endPrice).toBe(candle.close);
    });
    it('should update end date when warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.processCandle(candle);
      expect(analyzer.dates.end).toBe(toTimestamp('2020-01-01T00:01:00Z'));
    });
    it('should NOT update start date when already setup & warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.dates.start = toTimestamp('2019-01-01T00:00:00Z');
      analyzer.processCandle(candle);
      expect(analyzer.dates.start).toBe(toTimestamp('2019-01-01T00:00:00Z'));
    });
    it('should NOT update start price when start date is already setup & warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.dates.start = toTimestamp('2019-01-01T00:00:00Z');
      analyzer.startPrice = 10000;
      analyzer.processCandle(candle);
      expect(analyzer.startPrice).toBe(10000);
    });
    it('should update start date when already setup & warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.processCandle(candle);
      expect(analyzer.dates.start).toBe(candle.start);
    });
    it('should update start price when start date is already setup & warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.processCandle(candle);
      expect(analyzer.startPrice).toBe(candle.close);
    });
    it('should NOT call emitRoundtripUpdate when there is no round trip and warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.openRoundTrip = false;
      const emitRoundtripUpdateSpy = vi.spyOn(analyzer, 'emitRoundtripUpdate');
      analyzer.processCandle(candle);
      expect(emitRoundtripUpdateSpy).not.toHaveBeenCalled();
    });
    it('should call emitRoundtripUpdate when a round trip is open and warmup is done', () => {
      const candle = { close: 100, start: toTimestamp('2020-01-01T00:00:00Z') };
      analyzer.warmupCompleted = true;
      analyzer.openRoundTrip = true;
      const emitRoundtripUpdateSpy = vi.spyOn(analyzer, 'emitRoundtripUpdate');
      analyzer.processCandle(candle);
      expect(emitRoundtripUpdateSpy).toHaveBeenCalledOnce();
    });
  });
  describe('processFinalize', () => {
    it.todo('should send an empty report when no trade is done', () => {
      const calculateReportStatisticsSpy = vi.spyOn(analyzer, 'calculateReportStatistics');
      analyzer.processFinalize();
      expect(calculateReportStatisticsSpy).not.toHaveBeenCalled();
    });
    it('should call calculateReportStatistics when trades are done', () => {
      analyzer.trades = 50;
      const calculateReportStatisticsSpy = vi.spyOn(analyzer, 'calculateReportStatistics');
      analyzer.processFinalize();
      expect(calculateReportStatisticsSpy).toHaveBeenCalledOnce();
    });
    it('should emit when trades are done and report generated', () => {
      analyzer.trades = 50;
      vi.spyOn(analyzer, 'calculateReportStatistics').mockReturnValue({ label: 'REPORT' });
      const emitSpy = vi.spyOn(analyzer, 'emit');
      analyzer.processFinalize();
      expect(emitSpy).toHaveBeenCalledExactlyOnceWith(PERFORMANCE_REPORT_EVENT, {
        label: 'REPORT',
      });
    });
  });
  describe('emitRoundtripUpdate', () => {
    it('should NOT call deferredEmit when round trip entry is set', () => {
      analyzer.roundTrip.entry = undefined;
      const deferredEmitSpy = vi.spyOn(analyzer, 'deferredEmit');
      analyzer.emitRoundtripUpdate();
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
    it('should call deferredEmit when round trip entry is set', () => {
      analyzer.roundTrip.entry = {
        price: 900,
        date: toTimestamp('2020-01-01T00:00:00Z'),
        total: 1800,
        asset: 2,
        currency: 0,
      };
      analyzer.price = 1000;
      analyzer.dates.end = toTimestamp('2020-01-01T00:10:00Z');
      const deferredEmitSpy = vi.spyOn(analyzer, 'deferredEmit');
      analyzer.emitRoundtripUpdate();
      expect(deferredEmitSpy).toHaveBeenCalledExactlyOnceWith(ROUNDTRIP_UPDATE_EVENT, {
        at: toTimestamp('2020-01-01T00:10:00Z'),
        duration: 10 * 60 * 1000,
        uPnl: 200,
        uProfit: 11.11111111111111,
      });
    });
  });
  describe('registerRoundtripPart', () => {
    it('should ignore the first trade if it is a sell', () => {
      const trade = {
        action: 'sell',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      analyzer.trades = 1;
      analyzer.registerRoundtripPart(trade);
      expect(analyzer.roundTrip.entry).toBeNull();
      expect(analyzer.roundTrip.exit).toBeNull();
    });
    it('should register a buy trade as the entry of a new round trip', () => {
      const trade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      analyzer.registerRoundtripPart(trade);
      expect(analyzer.roundTrip.entry).toStrictEqual({
        date: trade.date,
        price: trade.price,
        total: 200,
        asset: trade.portfolio.asset,
        currency: trade.portfolio.currency,
      });
    });
    it('should open a round trip', () => {
      const trade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      analyzer.registerRoundtripPart(trade);
      expect(analyzer.openRoundTrip).toBeTruthy();
    });
    it('should clean previous roundtrip exit data', () => {
      analyzer.roundTrip.exit = {
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        total: 200,
        asset: 0,
        currency: 200,
      };
      const trade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      analyzer.registerRoundtripPart(trade);
      expect(analyzer.roundTrip.exit).toBeNull();
    });
    it('should register a sell trade as the exit of an open round trip', () => {
      const buyTrade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      const sellTrade = {
        action: 'sell',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 110,
        portfolio: { asset: 0, currency: 110 },
      };

      analyzer.registerRoundtripPart(buyTrade);
      analyzer.registerRoundtripPart(sellTrade);

      expect(analyzer.roundTrip.exit).toStrictEqual({
        date: sellTrade.date,
        price: sellTrade.price,
        total: sellTrade.portfolio.currency,
        asset: sellTrade.portfolio.asset,
        currency: sellTrade.portfolio.currency,
      });
    });
    it('should close a round trip', () => {
      const buyTrade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      const sellTrade = {
        action: 'sell',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 110,
        portfolio: { asset: 0, currency: 110 },
      };

      analyzer.registerRoundtripPart(buyTrade);
      analyzer.registerRoundtripPart(sellTrade);

      expect(analyzer.openRoundTrip).toBeFalsy();
    });
    it('should call handleCompletedRoundtrip', () => {
      const handleCompletedRoundtripSpy = vi.spyOn(analyzer, 'handleCompletedRoundtrip');
      const buyTrade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 100 },
      };
      const sellTrade = {
        action: 'sell',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 110,
        portfolio: { asset: 0, currency: 110 },
      };

      analyzer.registerRoundtripPart(buyTrade);
      analyzer.registerRoundtripPart(sellTrade);

      expect(handleCompletedRoundtripSpy).toHaveBeenCalledOnce();
    });
  });
  describe('handleCompletedRoundtrip', () => {
    it('should not process roundtrip if entry or exit is missing', () => {
      analyzer.roundTrip = { id: 1, entry: null, exit: null };
      analyzer.handleCompletedRoundtrip();
      expect(analyzer.roundTrips.length).toBe(0);
    });
    it('should create one valid roundtrip', () => {
      const roundTrip = {
        id: 0,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:10:00Z'), price: 110, total: 1100 },
      };

      analyzer.roundTrip = { ...roundTrip };
      analyzer.handleCompletedRoundtrip();

      expect(first(analyzer.roundTrips)).toStrictEqual({
        id: roundTrip.id,
        entryAt: roundTrip.entry.date,
        entryPrice: roundTrip.entry.price,
        entryBalance: roundTrip.entry.total,
        exitAt: roundTrip.exit.date,
        exitPrice: roundTrip.exit.price,
        exitBalance: roundTrip.exit.total,
        pnl: roundTrip.exit.total - roundTrip.entry.total,
        profit: 10,
        maxAdverseExcursion: 0,
        duration: 10 * 60 * 1000, // 10 minutes
      });
    });
    it('should store one valid roundtrip', () => {
      analyzer.roundTrip = {
        id: 0,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:10:00Z'), price: 110, total: 1100 },
      };

      analyzer.handleCompletedRoundtrip();

      expect(analyzer.roundTrips).toHaveLength(1);
    });
    it('should deferred emit the roundtrip event', () => {
      vi.spyOn(analyzer, 'deferredEmit');
      const roundTrip = {
        id: 0,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:10:00Z'), price: 110, total: 1100 },
      };

      analyzer.roundTrip = { ...roundTrip };

      analyzer.handleCompletedRoundtrip();

      expect(analyzer.deferredEmit).toHaveBeenCalledWith(ROUNDTRIP_EVENT, {
        id: roundTrip.id,
        entryAt: roundTrip.entry.date,
        entryPrice: roundTrip.entry.price,
        entryBalance: roundTrip.entry.total,
        exitAt: roundTrip.exit.date,
        exitPrice: roundTrip.exit.price,
        exitBalance: roundTrip.exit.total,
        pnl: roundTrip.exit.total - roundTrip.entry.total,
        profit: 10,
        maxAdverseExcursion: 0,
        duration: 10 * 60 * 1000, // 10 minutes
      });
    });
    it('should update exposure after a completed roundtrip', () => {
      analyzer.roundTrip = {
        id: 1,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:05:00Z'), price: 110, total: 1100 },
      };

      analyzer.handleCompletedRoundtrip();

      expect(analyzer.exposure).toBe(5 * 60 * 1000);
    });
    it('should update losses when a roundtrip results in a loss', () => {
      analyzer.roundTrip = {
        id: 1,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:05:00Z'), price: 90, total: 900 },
      };

      analyzer.handleCompletedRoundtrip();

      expect(analyzer.losses).toHaveLength(1);
    });
    it('should NOT update losses when a roundtrip results in a win', () => {
      analyzer.roundTrip = {
        id: 1,
        entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000 },
        exit: { date: toTimestamp('2020-01-01T00:05:00Z'), price: 110, total: 1100 },
      };

      analyzer.handleCompletedRoundtrip();

      expect(analyzer.losses).toHaveLength(0);
    });

    it('should track max adverse excursion during a roundtrip', () => {
      analyzer.warmupCompleted = true;
      const buyTrade = {
        action: 'buy',
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        portfolio: { asset: 1, currency: 0 },
      };
      const sellTrade = {
        action: 'sell',
        date: toTimestamp('2020-01-01T00:02:00Z'),
        price: 110,
        portfolio: { asset: 0, currency: 110 },
      };

      analyzer.registerRoundtripPart(buyTrade);
      // price drops to 90 before selling
      analyzer.processCandle({ close: 90, start: toTimestamp('2020-01-01T00:01:00Z') });
      analyzer.registerRoundtripPart(sellTrade);

      expect(first(analyzer.roundTrips)?.maxAdverseExcursion).toBe(10);
    });
  });
  describe('calculateReportStatistics', () => {
    beforeEach(() => {
      // Setup the initial state expected by calculateReportStatistics
      analyzer.start = { balance: 1000, portfolio: {} };
      analyzer.balance = 1200;
      analyzer.startPrice = 100;
      analyzer.endPrice = 130;
      analyzer.dates = {
        start: toTimestamp('2020-01-01T00:00:00Z'),
        end: toTimestamp('2020-01-10T00:00:00Z'),
      };
      analyzer.trades = 10;
      analyzer.roundTrips = [
        {
          id: 1,
          pnl: 50,
          profit: 5,
          maxAdverseExcursion: 0,
          entryAt: 0,
          entryPrice: 0,
          entryBalance: 0,
          exitAt: 0,
          exitPrice: 0,
          exitBalance: 0,
          duration: 0,
        },
        {
          id: 2,
          pnl: -20,
          profit: -2,
          maxAdverseExcursion: 0,
          entryAt: 0,
          entryPrice: 0,
          entryBalance: 0,
          exitAt: 0,
          exitPrice: 0,
          exitBalance: 0,
          duration: 0,
        },
      ];
      analyzer.losses = [{ id: 2, profit: -2 }];
      // Set exposure to 10 days in milliseconds
      analyzer.exposure = 3 * 60 * 60 * 1000;
    });

    it('should return undefined if start balance or portfolio is missing', () => {
      // Remove the start balance so that the report cannot be processed
      analyzer.start.balance = null;
      // Since calculateReportStatistics returns logImpossibleToProcessReport(), we expect undefined.
      const report = analyzer.calculateReportStatistics();
      expect(report).toBeUndefined();
    });

    it('should generate a correct report', () => {
      const report = analyzer.calculateReportStatistics();

      expect(report).toStrictEqual({
        alpha: -10,
        balance: 1200,
        downside: -2.23606797749979,
        endPrice: 130,
        endTime: toTimestamp('2020-01-10T00:00:00Z'),
        exposure: 0.013888888888888888,
        market: 30,
        profit: 200,
        ratioRoundTrips: 50,
        worstMaxAdverseExcursion: 0,
        relativeProfit: 20,
        relativeYearlyProfit: 811.1111111111111,
        sharpe: 230.3174603174603,
        startBalance: 1000,
        startPrice: 100,
        startTime: toTimestamp('2020-01-01T00:00:00Z'),
        duration: '9 days',
        trades: 10,
        yearlyProfit: 8111.111111111111,
      });
    });

    it('should report the worst MAE across roundtrips', () => {
      analyzer.roundTrips[0].maxAdverseExcursion = 5;
      analyzer.roundTrips[1].maxAdverseExcursion = 12;

      const report = analyzer.calculateReportStatistics();

      expect(report?.worstMaxAdverseExcursion).toBe(12);
    });
  });
});
