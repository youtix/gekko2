import { OnCandleEventParams, Strategy } from '@strategies/strategy.types';

interface DebugBacktestParams {
  buyCandleIndex: number | number[];
  sellCandleIndex: number | number[];
}

export class DebugBacktestStrategy extends Strategy<DebugBacktestParams> {
  private currentIndex = 1;

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DebugBacktestParams>, ..._indicators: unknown[]): void {
    const { strategyParams, createOrder } = tools;

    for (const symbol of candle.keys()) {
      const buyIndices = Array.isArray(strategyParams.buyCandleIndex) ? strategyParams.buyCandleIndex : [strategyParams.buyCandleIndex];
      if (buyIndices.includes(this.currentIndex)) {
        createOrder({
          type: 'MARKET',
          side: 'BUY',
          amount: 1, // Fixed amount for predictable PnL
          symbol,
        });
      }

      const sellIndices = Array.isArray(strategyParams.sellCandleIndex) ? strategyParams.sellCandleIndex : [strategyParams.sellCandleIndex];
      if (sellIndices.includes(this.currentIndex)) {
        createOrder({
          type: 'MARKET',
          side: 'SELL',
          amount: 1, // Fixed amount to close the position
          symbol,
        });
      }
    }

    this.currentIndex++;
  }
}
