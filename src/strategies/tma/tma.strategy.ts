import { TradeCompleted } from '@models/types/tradeStatus.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  onCandleAfterWarmup({ advice, debug, info }: Tools<TMAStrategyParams>, ...indicators: unknown[]): void {
    const [short, medium, long] = indicators;
    if (!isNumber(short) || !isNumber(medium) || !isNumber(long)) return;

    if (short > medium && medium > long) {
      info('strategy', `Executing long advice due to detected uptrend: ${short}/${medium}/${long}`);
      advice('long');
    } else if (short < medium && medium > long) {
      info('strategy', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      advice('short');
    } else if (short > medium && medium < long) {
      info('strategy', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      advice('short');
    } else {
      debug('strategy', `No clear trend detected: ${short}/${medium}/${long}`);
    }
  }
  init(addIndicator: AddIndicatorFn, strategyParams: TMAStrategyParams): void {
    const { long, medium, short, src } = strategyParams;
    addIndicator('SMA', { period: short, src });
    addIndicator('SMA', { period: medium, src });
    addIndicator('SMA', { period: long, src });
  }

  // NOT USED
  onTradeCompleted(_trade: TradeCompleted): void {}
  onEachCandle(_tools: Tools<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  log(_tools: Tools<TMAStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
