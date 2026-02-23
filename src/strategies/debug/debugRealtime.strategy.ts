import { OnCandleEventParams, Strategy } from '@strategies/strategy.types';

export class DebugRealtime implements Strategy<object> {
  private index = 0;

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<object>, ..._indicators: unknown[]): void {
    const { log, createOrder } = tools;

    for (const pair of candle.keys()) {
      log('debug', `Iteration: ${this.index} for ${pair}`);
      if (this.index === 0) {
        log('debug', `Trigger BUY for ${pair}`);
        createOrder({ type: 'MARKET', side: 'BUY', amount: 1, symbol: pair });
      } else if (this.index === 1) {
        log('debug', `Trigger SELL for ${pair}`);
        createOrder({ type: 'MARKET', side: 'SELL', amount: 1, symbol: pair });
      }
    }

    this.index++;
  }
}
