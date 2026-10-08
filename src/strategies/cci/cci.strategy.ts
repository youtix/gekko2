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
import { cciStrategySchema } from './cci.schema';
import { CCIStrategyParams, CCITrend } from './cci.types';

export class CCI implements Strategy<CCIStrategyParams> {
  static schema = cciStrategySchema;

  private trend: CCITrend;
  private pair?: TradingPair;
  // A trend starts again each time the CCI comes back from between the thresholds, and every order is all-in: the strategy buys only
  // when flat and sells only when long, never while its order is pending. Advised on every new overbought (oversold) trend, each SELL
  // (BUY) after the first was sized from what the previous one left, then refused once nothing was left, until maxConsecutiveErrors
  // stopped the bot. The trend of an order canceled or errored stays adviced: the next order waits for the next trend.
  private readonly position = new PositionTracker();

  constructor() {
    this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
  }

  init({ candle, tools, addIndicator }: InitParams<CCIStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('CCI', this.pair, { period: tools.strategyParams.period });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: IndicatorResults[]): void {
    const { strategyParams, createOrder, log } = tools;
    const [cci] = indicators;
    if (!isFiniteNumber(cci.results) || !this.pair) return;

    const { up, down, persistence } = strategyParams.thresholds;

    if (cci.results >= up) {
      if (this.trend.direction !== 'overbought') {
        log('info', 'CCI: overbought trend detected');
        this.trend = { direction: 'overbought', duration: 1, persisted: persistence === 0, adviced: false };
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
      }
      // Left unadviced while flat or while an order is pending: a BUY that fills during the trend is sold on its next candle
      if (this.trend.persisted && !this.trend.adviced && this.position.canSell()) {
        this.trend.adviced = true;
        this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else if (cci.results <= down) {
      if (this.trend.direction !== 'oversold') {
        log('info', 'CCI: oversold trend detected');
        this.trend = { direction: 'oversold', duration: 1, persisted: persistence === 0, adviced: false };
      } else {
        this.trend.duration++;
        if (this.trend.duration >= persistence) this.trend.persisted = true;
      }
      if (this.trend.persisted && !this.trend.adviced && this.position.canBuy()) {
        this.trend.adviced = true;
        this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else {
      if (this.trend.direction !== 'nodirection') {
        this.trend = { direction: 'nodirection', duration: 0, persisted: false, adviced: false };
      } else {
        this.trend.duration++;
      }
    }

    log('debug', `Trend: ${this.trend.direction} for ${this.trend.duration}`);
  }

  log({ tools }: OnCandleEventParams<CCIStrategyParams>, ...indicators: IndicatorResults[]): void {
    const [cci] = indicators;
    if (!isFiniteNumber(cci.results)) return;
    tools.log('debug', `CCI: ${cci.results.toFixed(2)}`);
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<CCIStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<CCIStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<CCIStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
