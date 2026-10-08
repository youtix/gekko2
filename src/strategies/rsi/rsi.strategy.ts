import { TradingPair } from '@models/utility.types';
import { PositionTracker } from '@strategies/positionTracker';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isFiniteNumber } from '@utils/math/math.utils';
import { pluralize } from '@utils/string/string.utils';
import { rsiStrategySchema } from './rsi.schema';
import { RSICurrentTrend, RSIStrategyParams } from './rsi.types';

export class RSI implements Strategy<RSIStrategyParams> {
  static schema = rsiStrategySchema;

  private trend: RSICurrentTrend;
  private pair?: TradingPair;
  // A trend starts again when the RSI crosses the other threshold, even for fewer candles than the persistence, and every order is
  // all-in: the strategy buys only when flat and sells only when long, never while its order is pending. A blip shorter than the
  // persistence advised the same side again, a BUY sized from what the previous one left, or a SELL with nothing left to sell. The
  // trend of an order canceled or errored stays adviced: the next order waits for the next trend.
  private readonly position = new PositionTracker();

  constructor() {
    this.trend = { direction: 'none', duration: 0, adviced: false };
  }

  init({ candle, tools, addIndicator }: InitParams<RSIStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('RSI', this.pair, { period, src });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<RSIStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { strategyParams, log, createOrder } = tools;
    const [rsi] = indicators;
    if (!isFiniteNumber(rsi.results) || !this.pair) return;
    const { thresholds } = strategyParams;

    if (rsi.results > thresholds.high) {
      if (this.trend.direction !== 'high') {
        log('info', 'RSI: high trend detected');
        this.trend = { duration: 0, direction: 'high', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In high trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      // Left unadviced while flat or while an order is pending: a BUY that fills during the trend is sold on its next candle
      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced && this.position.canSell()) {
        this.trend.adviced = true;
        this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else if (rsi.results < thresholds.low) {
      if (this.trend.direction !== 'low') {
        log('info', 'RSI: low trend detected');
        this.trend = { duration: 0, direction: 'low', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In low trend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= thresholds.persistence && !this.trend.adviced && this.position.canBuy()) {
        this.trend.adviced = true;
        this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    }
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<RSIStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<RSIStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<RSIStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
