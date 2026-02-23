import { TradingPair } from '@models/utility.types';
import { IndicatorResults, InitParams, OnCandleEventParams, Strategy } from '@strategies/strategy.types';
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

  onTimeframeCandleAfterWarmup({ tools }: OnCandleEventParams<TMAStrategyParams>, ...indicators: IndicatorResults<number | null>[]): void {
    const { log, createOrder } = tools;
    const [short, medium, long] = indicators;
    if (!this.pair || !isNumber(short.results) || !isNumber(medium.results) || !isNumber(long.results)) return;

    if (short.results > medium.results && medium.results > long.results) {
      log('info', `Executing long advice due to detected uptrend: ${short.results}/${medium.results}/${long.results}`);
      createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
    } else if (short.results < medium.results && medium.results > long.results) {
      log('info', `Executing short advice due to detected downtrend: ${short.results}/${medium.results}/${long.results}`);
      createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
    } else if (short.results > medium.results && medium.results < long.results) {
      log('info', `Executing short advice due to detected downtrend: ${short.results}/${medium.results}/${long.results}`);
      createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
    } else {
      log('debug', `No clear trend detected: ${short.results}/${medium.results}/${long.results}`);
    }
  }
}
