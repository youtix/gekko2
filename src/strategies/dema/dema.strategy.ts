import { TradingPair } from '@models/utility.types';
import { InitParams, OnCandleEventParams, Strategy } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { DEMAStrategyParams } from './dema.types';

export class DEMA extends Strategy<DEMAStrategyParams> {
  private currentTrend?: 'down' | 'up';
  private pair?: TradingPair;

  init({ candle, tools, addIndicator }: InitParams<DEMAStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    addIndicator('DEMA', this.pair, { period: tools.strategyParams.period });
    addIndicator('SMA', this.pair, { period: tools.strategyParams.period });
  }

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DEMAStrategyParams>, ...indicators: unknown[]) {
    const { strategyParams, log, createOrder } = tools;
    const [dema, sma] = indicators;
    if (!this.pair) return;
    const currentCandle = candle.get(this.pair);
    if (!currentCandle) return;
    const price = currentCandle.close;
    if (!isNumber(sma) || !isNumber(dema)) return;

    const diff = sma - dema;

    const message = '@ ' + price.toFixed(8) + ' (' + dema.toFixed(5) + '/' + diff.toFixed(5) + ')';

    if (diff > strategyParams.thresholds.up) {
      log('debug', `We are currently in uptrend: ${message}`);

      if (this.currentTrend !== 'up') {
        this.currentTrend = 'up';
        log('info', `Executing long advice due to detected uptrend: ${message}`);
        createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
      }
    } else if (diff < strategyParams.thresholds.down) {
      log('debug', `We are currently in a downtrend: ${message}`);

      if (this.currentTrend !== 'down') {
        this.currentTrend = 'down';
        log('info', `Executing short advice due to detected downtrend: ${message}`);
        createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
      }
    } else {
      log('debug', `We are currently not in an up or down trend: ${message}`);
    }
  }

  log({ tools }: OnCandleEventParams<DEMAStrategyParams>, ...indicators: unknown[]): void {
    const { log } = tools;
    const [dema, sma] = indicators;
    if (!isNumber(sma) || !isNumber(dema)) return;

    log('debug', ['Calculated DEMA and SMA properties for candle:', `DEMA: ${dema.toFixed(5)}`, `SMA: ${sma.toFixed(5)}`].join(' '));
  }
}
