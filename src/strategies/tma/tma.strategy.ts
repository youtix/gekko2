import { TradeCompleted } from '@models/tradeStatus.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { TMAStrategyParams } from './tma.types';

export class TMA implements Strategy<TMAStrategyParams> {
  onCandleAfterWarmup({ advice, log }: Tools<TMAStrategyParams>, ...indicators: unknown[]): void {
    const [short, medium, long] = indicators;
    if (!isNumber(short) || !isNumber(medium) || !isNumber(long)) return;

    if (short > medium && medium > long) {
      log('info', `Executing long advice due to detected uptrend: ${short}/${medium}/${long}`);
      advice('long');
    } else if (short < medium && medium > long) {
      log('info', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      advice('short');
    } else if (short > medium && medium < long) {
      log('info', `Executing short advice due to detected downtrend: ${short}/${medium}/${long}`);
      advice('short');
    } else {
      log('debug', `No clear trend detected: ${short}/${medium}/${long}`);
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
