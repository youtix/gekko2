import { Candle } from '@models/types/candle.types';
import { TradeCompleted } from '@models/types/tradeStatus.types';
import { PERFORMANCE_REPORT_EVENT, ROUNDTRIP_COMPLETED_EVENT } from '@plugins/plugin.const';
import { addMinutes } from 'date-fns';
import { first, isNil } from 'lodash-es';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toTimestamp } from '../../utils/date/date.utils';
import { PerformanceAnalyzer } from './performanceAnalyzer';
import { SingleRoundTrip } from './performanceAnalyzer.types';

vi.mock('./performanceAnalyzer.utils');
vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({})),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

describe('PerformanceAnalyzer', () => {
  let analyzer: PerformanceAnalyzer;
  const defaultCandle: Candle = { close: 1, high: 2, low: 0, open: 1, start: toTimestamp('2025'), volume: 10 };
  const defaultBuyTradeEvent: TradeCompleted = {
    action: 'buy',
    id: 'buy',
    adviceId: 'buyAdvice',
    date: 0,
    portfolio: { asset: 100, currency: 200 },
    balance: 1000,
    price: 100,
    cost: 1,
    amount: 30,
    effectivePrice: 31,
    feePercent: 0.33,
  };
  const defaultSellTradeEvent: TradeCompleted = {
    action: 'sell',
    id: 'sell',
    adviceId: 'sellAdvice',
    date: 0,
    portfolio: { asset: 101, currency: 199 },
    balance: 1001,
    price: 110,
    cost: 1,
    amount: 30,
    effectivePrice: 31,
    feePercent: 0.33,
  };
  const defaultRoundtrip: SingleRoundTrip = {
    id: 0,
    entry: { date: toTimestamp('2020-01-01T00:00:00Z'), price: 100, total: 1000, asset: 10, currency: 100 },
    exit: { date: toTimestamp('2020-01-01T00:10:00Z'), price: 110, total: 1100, asset: 1, currency: 1000 },
  };

  beforeEach(() => {
    analyzer = new PerformanceAnalyzer({ name: 'PerformanceAnalyzer', riskFreeReturn: 5, enableConsoleTable: false });
    analyzer['deferredEmit'] = () => {};
    analyzer['emit'] = (_: string | symbol) => false;
  });

  describe('onPortfolioValueChange', () => {
    it('should set balance on each protfolio change', () => {
      analyzer.onPortfolioValueChange({ balance: 1000 });
      expect(analyzer['balance']).toBe(1000);
    });
    it('should set start balance for the first time', () => {
      analyzer.onPortfolioValueChange({ balance: 2000 });
      expect(analyzer['start'].balance).toBe(2000);
    });
    it('should NOT set start balance when already set', () => {
      analyzer['start'].balance = 1000;
      analyzer.onPortfolioValueChange({ balance: 2000 });
      expect(analyzer['start'].balance).toBe(1000);
    });
    it.each`
      initBalance  | eventBalance | expectedStartBalance | expectedBalance
      ${undefined} | ${1000}      | ${1000}              | ${1000}
      ${500}       | ${1500}      | ${500}               | ${1500}
    `(
      'sets start.balance and balance correctly when initBalance is $initBalance and event.balance is $eventBalance',
      ({ initBalance, eventBalance, expectedStartBalance, expectedBalance }) => {
        if (!isNil(initBalance)) {
          analyzer['start'].balance = initBalance;
        }
        analyzer.onPortfolioValueChange({ balance: eventBalance });
        expect(analyzer['start'].balance).toBe(expectedStartBalance);
        expect(analyzer['balance']).toBe(expectedBalance);
      },
    );
  });
  describe('onPortfolioChange', () => {
    it('should set start.portfolio if NOT already set', () => {
      const portfolioEvent = { balance: 1000, asset: 10, currency: 0 };
      analyzer.onPortfolioChange(portfolioEvent);
      expect(analyzer['start'].portfolio).toEqual(portfolioEvent);
    });
    it('should NOT set start.portfolio if already set', () => {
      analyzer['start'].portfolio = { asset: 0, currency: 2000 };
      const portfolioEvent = { asset: 0, currency: 1000 };
      analyzer.onPortfolioChange(portfolioEvent);
      expect(analyzer['start'].portfolio.currency).toEqual(2000);
    });
  });
  describe('onStrategyWarmupCompleted', () => {
    it('should set warmup completed to true', () => {
      analyzer['onStrategyWarmupCompleted'](defaultCandle);
      expect(analyzer['warmupCompleted']).toBeTruthy();
    });
    it('should update start price when warmup is done', () => {
      analyzer['onStrategyWarmupCompleted'](defaultCandle);
      expect(analyzer['startPrice']).toBe(defaultCandle.close);
    });
    it('should update start date when warmup is done', () => {
      analyzer['onStrategyWarmupCompleted'](defaultCandle);
      expect(analyzer['dates'].start).toBe(defaultCandle.start);
    });
    it('should call processOneMinuteCandle if warmup candle is set', () => {
      const processOneMinuteCandleSpy = vi.spyOn(analyzer as any, 'processOneMinuteCandle');
      analyzer['warmupCandle'] = defaultCandle;
      analyzer['onStrategyWarmupCompleted'](defaultCandle);
      expect(processOneMinuteCandleSpy).toHaveBeenCalledOnce();
    });
    it('should NOT call processOneMinuteCandle if warmup candle is missing', () => {
      const processOneMinuteCandleSpy = vi.spyOn(analyzer as any, 'processOneMinuteCandle');
      analyzer['onStrategyWarmupCompleted'](defaultCandle);
      expect(processOneMinuteCandleSpy).not.toHaveBeenCalled();
    });
  });
  describe('onTradeCompleted', () => {
    it('should NOT process if the first trade is a sell', () => {
      analyzer['trades'] = 0;
      analyzer.onTradeCompleted(defaultSellTradeEvent);
      expect(analyzer['trades']).toBe(0);
    });
    it('should increment trades', () => {
      analyzer.onTradeCompleted(defaultBuyTradeEvent);
      expect(analyzer['trades']).toBe(1);
    });
    it('should update balance', () => {
      analyzer.onTradeCompleted(defaultBuyTradeEvent);
      expect(analyzer['balance']).toBe(defaultBuyTradeEvent.balance);
    });
    it('should NOT emit when report is NOT generated', () => {
      vi.spyOn(analyzer as any, 'calculateReportStatistics').mockReturnValue(undefined);
      const deferredEmitSpy = vi.spyOn(analyzer as any, 'deferredEmit');
      analyzer.onTradeCompleted(defaultBuyTradeEvent);
      expect(deferredEmitSpy).not.toHaveBeenCalled();
    });
  });
  describe('processOneMinuteCandle', () => {
    it('should update warmup candle when performance analyzer is warming up', () => {
      analyzer['warmupCompleted'] = false;
      analyzer['processOneMinuteCandle'](defaultCandle);
      expect(analyzer['warmupCandle']).toBe(defaultCandle);
    });
    it('should update end price when warmup is done', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['processOneMinuteCandle'](defaultCandle);
      expect(analyzer['endPrice']).toBe(defaultCandle.close);
    });
    it('should update end date when warmup is done', () => {
      analyzer['warmupCompleted'] = true;
      analyzer['processOneMinuteCandle'](defaultCandle);
      expect(analyzer['dates'].end).toBe(addMinutes(defaultCandle.start, 1).getTime());
    });
  });
  describe('processFinalize', () => {
    it.todo('should send an empty report when no trade is done', () => {
      const calculateReportStatisticsSpy = vi.spyOn(analyzer as any, 'calculateReportStatistics');
      analyzer['processFinalize']();
      expect(calculateReportStatisticsSpy).not.toHaveBeenCalled();
    });
    it('should call calculateReportStatistics when trades are done', () => {
      analyzer['trades'] = 50;
      const calculateReportStatisticsSpy = vi.spyOn(analyzer as any, 'calculateReportStatistics');
      analyzer['processFinalize']();
      expect(calculateReportStatisticsSpy).toHaveBeenCalledOnce();
    });
    it('should emit when trades are done and report generated', () => {
      analyzer['trades'] = 50;
      vi.spyOn(analyzer as any, 'calculateReportStatistics').mockReturnValue({ label: 'REPORT' });
      const emitSpy = vi.spyOn(analyzer as any, 'emit');
      analyzer['processFinalize']();
      expect(emitSpy).toHaveBeenCalledExactlyOnceWith(PERFORMANCE_REPORT_EVENT, {
        label: 'REPORT',
      });
    });
  });
  describe('registerRoundtripPart', () => {
    it('should register a buy trade as the entry of a new round trip', () => {
      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      expect(analyzer['roundTrip'].entry).toStrictEqual({
        date: defaultBuyTradeEvent.date,
        price: defaultBuyTradeEvent.price,
        total: 10200,
        asset: defaultBuyTradeEvent.portfolio.asset,
        currency: defaultBuyTradeEvent.portfolio.currency,
      });
    });
    it('should open a round trip', () => {
      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      expect(analyzer['openRoundTrip']).toBeTruthy();
    });
    it('should clean previous roundtrip exit data', () => {
      analyzer['roundTrip'].exit = {
        date: toTimestamp('2020-01-01T00:00:00Z'),
        price: 100,
        total: 11309,
        asset: 0,
        currency: 200,
      };
      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      expect(analyzer['roundTrip'].exit).toBeNull();
    });
    it('should register a sell trade as the exit of an open round trip', () => {
      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      analyzer['registerRoundtripPart'](defaultSellTradeEvent);

      expect(analyzer['roundTrip'].exit).toStrictEqual({
        date: defaultSellTradeEvent.date,
        price: defaultSellTradeEvent.price,
        total: 11309,
        asset: defaultSellTradeEvent.portfolio.asset,
        currency: defaultSellTradeEvent.portfolio.currency,
      });
    });
    it('should close a round trip', () => {
      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      analyzer['registerRoundtripPart'](defaultSellTradeEvent);

      expect(analyzer['openRoundTrip']).toBeFalsy();
    });
    it('should call handleCompletedRoundtrip', () => {
      const handleCompletedRoundtripSpy = vi.spyOn(analyzer as any, 'handleCompletedRoundtrip');

      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      analyzer['registerRoundtripPart'](defaultSellTradeEvent);

      expect(handleCompletedRoundtripSpy).toHaveBeenCalledOnce();
    });
  });
  describe('handleCompletedRoundtrip', () => {
    it('should not process roundtrip if entry or exit is missing', () => {
      analyzer['roundTrip'] = { id: 1, entry: null, exit: null };
      analyzer['handleCompletedRoundtrip']();
      expect(analyzer['roundTrips'].length).toBe(0);
    });
    it('should create one valid roundtrip', () => {
      analyzer['roundTrip'] = { ...defaultRoundtrip };
      analyzer['handleCompletedRoundtrip']();

      expect(first(analyzer['roundTrips'])).toStrictEqual({
        id: defaultRoundtrip.id,
        entryAt: defaultRoundtrip.entry?.date,
        entryPrice: defaultRoundtrip.entry?.price,
        entryBalance: defaultRoundtrip.entry?.total,
        exitAt: defaultRoundtrip.exit?.date,
        exitPrice: defaultRoundtrip.exit?.price,
        exitBalance: defaultRoundtrip.exit?.total,
        pnl: (defaultRoundtrip.exit?.total ?? 0) - (defaultRoundtrip.entry?.total ?? 0),
        profit: 10,
        maxAdverseExcursion: 0,
        duration: 10 * 60 * 1000, // 10 minutes
      });
    });
    it('should store one valid roundtrip', () => {
      analyzer['roundTrip'] = defaultRoundtrip;
      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['roundTrips']).toHaveLength(1);
    });
    it('should deferred emit the roundtrip event', () => {
      vi.spyOn(analyzer as any, 'deferredEmit');

      analyzer['roundTrip'] = { ...defaultRoundtrip };

      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['deferredEmit']).toHaveBeenCalledWith(ROUNDTRIP_COMPLETED_EVENT, {
        id: defaultRoundtrip.id,
        entryAt: defaultRoundtrip.entry?.date,
        entryPrice: defaultRoundtrip.entry?.price,
        entryBalance: defaultRoundtrip.entry?.total,
        exitAt: defaultRoundtrip.exit?.date,
        exitPrice: defaultRoundtrip.exit?.price,
        exitBalance: defaultRoundtrip.exit?.total,
        pnl: (defaultRoundtrip.exit?.total ?? 0) - (defaultRoundtrip.entry?.total ?? 0),
        profit: 10,
        maxAdverseExcursion: 0,
        duration: 10 * 60 * 1000, // 10 minutes
      });
    });
    it('should update exposure after a completed roundtrip', () => {
      analyzer['roundTrip'] = defaultRoundtrip;

      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['exposure']).toBe(10 * 60 * 1000); // 10 minutes
    });
    it('should update losses when a roundtrip results in a loss', () => {
      analyzer['roundTrip'] = {
        ...defaultRoundtrip,
        exit: { price: 90, asset: 10, currency: 20, date: toTimestamp('2025'), total: -2 },
      };

      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['losses']).toHaveLength(1);
    });
    it('should NOT update losses when a roundtrip results in a win', () => {
      analyzer['roundTrip'] = defaultRoundtrip;

      analyzer['handleCompletedRoundtrip']();

      expect(analyzer['losses']).toHaveLength(0);
    });

    it('should track max adverse excursion during a roundtrip', () => {
      analyzer['warmupCompleted'] = true;

      analyzer['registerRoundtripPart'](defaultBuyTradeEvent);
      // Low price drops to 90 and close to 100 before selling
      analyzer['processOneMinuteCandle']({ ...defaultCandle, low: 90 });
      analyzer['registerRoundtripPart'](defaultSellTradeEvent);

      expect(first(analyzer['roundTrips'])?.['maxAdverseExcursion']).toBe(10);
    });
  });
  describe('calculateReportStatistics', () => {
    beforeEach(() => {
      // Setup the initial state expected by calculateReportStatistics
      analyzer['start'] = { balance: 1000, portfolio: { asset: 0, currency: 1000 } };
      analyzer['balance'] = 1200;
      analyzer['startPrice'] = 100;
      analyzer['endPrice'] = 130;
      analyzer['dates'] = {
        start: toTimestamp('2020-01-01T00:00:00Z'),
        end: toTimestamp('2020-01-10T00:00:00Z'),
      };
      analyzer['trades'] = 10;
      analyzer['roundTrips'] = [
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
      analyzer['losses'] = [
        {
          id: 2,
          profit: -2,
          duration: 1000,
          entryAt: toTimestamp('2025'),
          entryBalance: 1000,
          entryPrice: 100,
          exitAt: toTimestamp('2025'),
          exitBalance: 998,
          exitPrice: 98,
          maxAdverseExcursion: 2,
          pnl: -2,
        },
      ];
      analyzer['exposure'] = 3 * 60 * 60 * 1000; // 3h
    });

    it('should return undefined if start balance is equal to zero', () => {
      analyzer['start'].balance = 0;
      const report = analyzer['calculateReportStatistics']();
      expect(report).toBeUndefined();
    });
    it('should return undefined if portfolio data are missing', () => {
      analyzer['start'].portfolio = null;
      const report = analyzer['calculateReportStatistics']();
      expect(report).toBeUndefined();
    });

    it('should generate a correct report', () => {
      const report = analyzer['calculateReportStatistics']();

      expect(report).toStrictEqual({
        alpha: -10,
        balance: 1200,
        downside: -2.23606797749979,
        endPrice: 130,
        endTime: toTimestamp('2020-01-10T00:00:00Z'),
        exposure: 1.3888888888888888,
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

    it('should set ratioRoundTrips to null when no roundtrips exist', () => {
      analyzer['roundTrips'] = [];
      analyzer['losses'] = [];
      analyzer['trades'] = 0;
      analyzer['exposure'] = 0;

      const report = analyzer['calculateReportStatistics']();

      expect(report?.ratioRoundTrips).toBeNull();
    });

    it('should report the worst MAE across roundtrips', () => {
      analyzer['roundTrips'][0].maxAdverseExcursion = 5;
      analyzer['roundTrips'][1].maxAdverseExcursion = 12;

      const report = analyzer['calculateReportStatistics']();

      expect(report?.worstMaxAdverseExcursion).toBe(12);
    });

    it('should set sharpe to 0 when there is no volatility', () => {
      analyzer['roundTrips'] = [
        {
          id: 1,
          profit: 2,
          pnl: 0,
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
          profit: 2,
          pnl: 0,
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

      const report = analyzer['calculateReportStatistics']();

      expect(report?.sharpe).toBe(0);
    });

    it('should set sharpe to 0 when there are no roundtrips', () => {
      analyzer['roundTrips'] = [];

      const report = analyzer['calculateReportStatistics']();

      expect(report?.sharpe).toBe(0);
    });
  });
});
