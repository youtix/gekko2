import { TradingPair } from '@models/utility.types';
import { pickTradedPair, PositionTracker } from '@strategies/positionTracker';
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
import { isObject } from 'lodash-es';
import { macdStrategySchema } from './macd.schema';
import { MACDStrategyParams, MACDTrend } from './macd.types';

export class MACD implements Strategy<MACDStrategyParams> {
  static schema = macdStrategySchema;

  private trend?: MACDTrend;
  private pair?: TradingPair;
  // A trend starts again when the MACD crosses back, even for fewer candles than the persistence, and every order is all-in: the
  // strategy buys only when flat and sells only when long, never while its order is pending. A blip shorter than the persistence
  // advised the same side again, a BUY sized from what the previous one left, or a SELL with nothing left to sell. The trend of an
  // order canceled or errored stays adviced: the next order waits for the next trend.
  private readonly position = new PositionTracker();

  init({ candle, tools, addIndicator }: InitParams<MACDStrategyParams>): void {
    const { strategyParams } = tools;
    this.pair = pickTradedPair(candle, tools);
    addIndicator('MACD', this.pair, { short: strategyParams.short, long: strategyParams.long, signal: strategyParams.signal });
    this.trend = { direction: 'none', duration: 0, persisted: false, adviced: false };
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<MACDStrategyParams>,
    ...indicators: IndicatorResults<{ macd: number; signal: number; hist: number } | null>[]
  ): void {
    const { strategyParams, log, createOrder } = tools;
    const { macdSrc } = strategyParams;
    const [macd] = indicators;

    if (!this.isMacd(macd.results) || !this.pair) return;

    if (macd.results[macdSrc] > strategyParams.thresholds.up) {
      if (this.trend?.direction !== 'up') {
        log('info', 'MACD: up trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'up', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In uptrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      // Left unadviced while long or while an order is pending: a SELL that fills during the trend is bought back on its next candle
      if (this.trend.persisted && !this.trend.adviced && this.position.canBuy()) {
        this.trend.adviced = true;
        this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else if (macd.results[macdSrc] < strategyParams.thresholds.down) {
      if (this.trend?.direction !== 'down') {
        log('info', 'MACD: down trend detected');
        this.trend = { duration: 0, persisted: false, direction: 'down', adviced: false };
      }
      this.trend.duration++;
      log('debug', `In downtrend since ${this.trend.duration} ${pluralize('candle', this.trend.duration)}`);

      if (this.trend.duration >= strategyParams.thresholds.persistence) this.trend.persisted = true;

      if (this.trend.persisted && !this.trend.adviced && this.position.canSell()) {
        this.trend.adviced = true;
        this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else {
      log('debug', 'MACD: no trend detected');
    }
  }

  log(
    { tools }: OnCandleEventParams<MACDStrategyParams>,
    ...indicators: IndicatorResults<{ macd: number; signal: number; hist: number } | null>[]
  ): void {
    const { log } = tools;
    const [macd] = indicators;
    if (!this.isMacd(macd.results)) return;

    log('debug', `macd: ${macd.results.macd.toFixed(8)}`);
    log('debug', `signal: ${macd.results.signal.toFixed(8)}`);
    log('debug', `hist: ${macd.results.hist.toFixed(8)}`);
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<MACDStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<MACDStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<MACDStrategyParams>): void {
    this.position.onOrderErrored(params);
  }

  private isMacd(data: unknown): data is { macd: number; signal: number; hist: number } {
    return (
      isObject(data) &&
      'macd' in data &&
      'signal' in data &&
      'hist' in data &&
      isFiniteNumber(data.macd) &&
      isFiniteNumber(data.signal) &&
      isFiniteNumber(data.hist)
    );
  }
}
