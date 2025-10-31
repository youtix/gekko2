import { OrderCompleted, OrderErrored } from '@models/order.types';
import { AddIndicatorFn, Strategy, Tools } from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { DEMAStrategyParams } from './dema.types';

export class DEMA implements Strategy<DEMAStrategyParams> {
  private currentTrend?: 'down' | 'up';

  init(addIndicator: AddIndicatorFn, strategyParams: DEMAStrategyParams): void {
    addIndicator('DEMA', { period: strategyParams.period });
    addIndicator('SMA', { period: strategyParams.period });
  }

  onCandleAfterWarmup(
    { candle, strategyParams, createOrder, log }: Tools<DEMAStrategyParams>,
    ...indicators: unknown[]
  ): void {
    const [dema, sma] = indicators;
    const price = candle.close;
    if (!isNumber(sma) || !isNumber(dema)) return;

    const diff = sma - dema;

    const message = '@ ' + price.toFixed(8) + ' (' + dema.toFixed(5) + '/' + diff.toFixed(5) + ')';

    if (diff > strategyParams.thresholds.up) {
      log('debug', `We are currently in uptrend: ${message}`);

      if (this.currentTrend !== 'up') {
        this.currentTrend = 'up';
        log('info', `Executing long advice due to detected uptrend: ${message}`);
        createOrder({ type: 'STICKY', side: 'BUY' });
      }
    } else if (diff < strategyParams.thresholds.down) {
      log('debug', `We are currently in a downtrend: ${message}`);

      if (this.currentTrend !== 'down') {
        this.currentTrend = 'down';
        log('info', `Executing short advice due to detected downtrend: ${message}`);
        createOrder({ type: 'STICKY', side: 'SELL' });
      }
    } else {
      log('debug', `We are currently not in an up or down trend: ${message}`);
    }
  }

  log({ log }: Tools<DEMAStrategyParams>, ...indicators: unknown[]): void {
    const [dema, sma] = indicators;
    if (!isNumber(sma) || !isNumber(dema)) return;

    log(
      'debug',
      ['Calculated DEMA and SMA properties for candle:', `DEMA: ${dema.toFixed(5)}`, `SMA: ${sma.toFixed(5)}`].join(
        ' ',
      ),
    );
  }

  // NOT USED
  onEachCandle(_tools: Tools<DEMAStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_order: OrderCompleted): void {}
  onOrderErrored(_order: OrderErrored): void {}
  end(): void {}
}
