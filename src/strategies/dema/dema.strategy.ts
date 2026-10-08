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
import { demaStrategySchema } from './dema.schema';
import { DEMAStrategyParams } from './dema.types';

export class DEMA implements Strategy<DEMAStrategyParams> {
  static schema = demaStrategySchema;

  private currentTrend?: 'down' | 'up';
  // Whether the current trend has placed its order. It waits while the strategy holds the other position or an order is pending: a
  // BUY that fills during a downtrend is sold on the next candle of that downtrend.
  private isTrendAdviced = false;
  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. Advised on
  // each change of trend, its first SELL had nothing to sell, and it switched side while its STICKY order was still open. The trend
  // of an order canceled or errored stays adviced: the next order waits for the next trend.
  private readonly position = new PositionTracker();

  init({ candle, tools, addIndicator }: InitParams<DEMAStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('DEMA', this.pair, { period: tools.strategyParams.period });
    addIndicator('SMA', this.pair, { period: tools.strategyParams.period });
  }

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DEMAStrategyParams>, ...indicators: IndicatorResults[]) {
    const { strategyParams, log, createOrder } = tools;
    const [dema, sma] = indicators;
    if (!this.pair) return;
    const currentCandle = candle.get(this.pair);
    if (!currentCandle) return;
    const price = currentCandle.close;
    if (!isFiniteNumber(sma.results) || !isFiniteNumber(dema.results)) return;

    const diff = sma.results - dema.results;

    const message = '@ ' + price.toFixed(8) + ' (' + dema.results.toFixed(5) + '/' + diff.toFixed(5) + ')';

    if (diff > strategyParams.thresholds.up) {
      log('debug', `We are currently in uptrend: ${message}`);

      if (this.currentTrend !== 'up') {
        this.currentTrend = 'up';
        this.isTrendAdviced = false;
      }
      if (!this.isTrendAdviced && this.position.canBuy()) {
        this.isTrendAdviced = true;
        log('info', `Executing long advice due to detected uptrend: ${message}`);
        this.position.buy(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else if (diff < strategyParams.thresholds.down) {
      log('debug', `We are currently in a downtrend: ${message}`);

      if (this.currentTrend !== 'down') {
        this.currentTrend = 'down';
        this.isTrendAdviced = false;
      }
      if (!this.isTrendAdviced && this.position.canSell()) {
        this.isTrendAdviced = true;
        log('info', `Executing short advice due to detected downtrend: ${message}`);
        this.position.sell(createOrder, { type: 'STICKY', symbol: this.pair });
      }
    } else {
      log('debug', `We are currently not in an up or down trend: ${message}`);
    }
  }

  log({ tools }: OnCandleEventParams<DEMAStrategyParams>, ...indicators: IndicatorResults[]): void {
    const { log } = tools;
    const [dema, sma] = indicators;
    if (!isFiniteNumber(sma.results) || !isFiniteNumber(dema.results)) return;

    log(
      'debug',
      ['Calculated DEMA and SMA properties for candle:', `DEMA: ${dema.results.toFixed(5)}`, `SMA: ${sma.results.toFixed(5)}`].join(' '),
    );
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<DEMAStrategyParams>): void {
    this.position.onOrderCompleted(params);
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<DEMAStrategyParams>): void {
    this.position.onOrderCanceled(params);
  }

  onOrderErrored(params: OnOrderErroredEventParams<DEMAStrategyParams>): void {
    this.position.onOrderErrored(params);
  }
}
