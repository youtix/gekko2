import { TradingPair } from '@models/utility.types';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { UUID } from 'node:crypto';
import { DEMAStrategyParams } from './dema.types';

export class DEMA implements Strategy<DEMAStrategyParams> {
  private currentTrend?: 'down' | 'up';
  // Whether the current trend has placed its order. It waits while the strategy holds the other position or an order is pending: a
  // BUY that fills during a downtrend is sold on the next candle of that downtrend.
  private isTrendAdviced = false;
  private pair?: TradingPair;
  // Every order is all-in: the strategy buys only when flat and sells only when long, never while its order is pending. Advised on
  // each change of trend, its first SELL had nothing to sell, and it switched side while its STICKY order was still open.
  private isLong = false;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder = false;

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
    if (!isNumber(sma.results) || !isNumber(dema.results)) return;

    const diff = sma.results - dema.results;

    const message = '@ ' + price.toFixed(8) + ' (' + dema.results.toFixed(5) + '/' + diff.toFixed(5) + ')';

    if (diff > strategyParams.thresholds.up) {
      log('debug', `We are currently in uptrend: ${message}`);

      if (this.currentTrend !== 'up') {
        this.currentTrend = 'up';
        this.isTrendAdviced = false;
      }
      if (!this.isTrendAdviced && !this.isLong && !this.isPendingOrder) {
        this.isTrendAdviced = true;
        log('info', `Executing long advice due to detected uptrend: ${message}`);
        this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else if (diff < strategyParams.thresholds.down) {
      log('debug', `We are currently in a downtrend: ${message}`);

      if (this.currentTrend !== 'down') {
        this.currentTrend = 'down';
        this.isTrendAdviced = false;
      }
      if (!this.isTrendAdviced && this.isLong && !this.isPendingOrder) {
        this.isTrendAdviced = true;
        log('info', `Executing short advice due to detected downtrend: ${message}`);
        this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
        this.isPendingOrder = true;
      }
    } else {
      log('debug', `We are currently not in an up or down trend: ${message}`);
    }
  }

  log({ tools }: OnCandleEventParams<DEMAStrategyParams>, ...indicators: IndicatorResults[]): void {
    const { log } = tools;
    const [dema, sma] = indicators;
    if (!isNumber(sma.results) || !isNumber(dema.results)) return;

    log(
      'debug',
      ['Calculated DEMA and SMA properties for candle:', `DEMA: ${dema.results.toFixed(5)}`, `SMA: ${sma.results.toFixed(5)}`].join(' '),
    );
  }

  onOrderCompleted({ order }: OnOrderCompletedEventParams<DEMAStrategyParams>): void {
    if (order.id === this.buyOrderId) {
      this.isLong = true;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (order.id === this.sellOrderId) {
      this.isLong = false;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }

  onOrderCanceled({ order }: OnOrderCanceledEventParams<DEMAStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  onOrderErrored({ order }: OnOrderErroredEventParams<DEMAStrategyParams>): void {
    this.handleOrderFailure(order.id);
  }

  /**
   * An order canceled or errored leaves the position as it was before it. The trend it was placed in is adviced: the next order waits
   * for the next trend. What a canceled order filled is still held: the next all-in order completes it.
   */
  private handleOrderFailure(orderId: UUID) {
    if (orderId === this.buyOrderId) {
      this.isLong = false;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (orderId === this.sellOrderId) {
      this.isLong = true;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }
}
