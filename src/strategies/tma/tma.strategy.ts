import { TradingPair } from '@models/utility.types';
import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  private pair?: TradingPair;

  init({ candle, tools, addIndicator }: InitParams<TMAStrategyParams>): void {
    const { long, medium, short, src } = tools.strategyParams;
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('SMA', this.pair, { period: short, src });
    addIndicator('SMA', this.pair, { period: medium, src });
    addIndicator('SMA', this.pair, { period: long, src });
  }

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<TMAStrategyParams>, ...indicators: unknown[]): void {
    const { log, createOrder } = tools;
    const [short, medium, long] = indicators;
    if (!this.pair || !isNumber(short) || !isNumber(medium) || !isNumber(long)) return;

    if (short > medium && medium > long) {
      log('info', `Executing long advice due to detected uptrend: ${short}/${medium}/${long}`);
      createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
    } else if (short < medium && medium > long) {
      log('info', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
    } else if (short > medium && medium < long) {
      log('info', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
    } else {
      log('debug', `No clear trend detected: ${short}/${medium}/${long}`);
    }
  }

  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  log(_params: OnCandleEventParams<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
