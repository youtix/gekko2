import {
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { isNumber } from 'lodash-es';
import { SMACrossoverStrategyParams } from './smaCrossover.types';

/**
 * Simple Moving Average Crossover Strategy
 *
 * - When MA crosses UP the market price => SELL (market order, all in)
 * - When MA crosses DOWN the market price => BUY (market order, all in)
 *
 * A crossover is detected by comparing the previous relative position
 * of the price vs the SMA to the current one.
 */
export class SMACrossover implements Strategy<SMACrossoverStrategyParams> {
  /** Tracks whether price was above SMA in the previous candle */
  private wasPriceAboveSMA: boolean | null = null;

  init({ tools, addIndicator }: InitParams<SMACrossoverStrategyParams>): void {
    const { period, src } = tools.strategyParams;
    addIndicator('SMA', { period, src });
  }

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>, ...indicators: unknown[]): void {
    const { log, createOrder } = tools;
    const [sma] = indicators;
    const price = candle.close;

    if (!isNumber(sma)) return;

    const isPriceAboveSMA = price > sma;

    // First candle after warmup - just record the position
    if (this.wasPriceAboveSMA === null) {
      this.wasPriceAboveSMA = isPriceAboveSMA;
      log('info', `Initial state: price ${isPriceAboveSMA ? 'above' : 'below'} SMA`);
      return;
    }

    // Detect crossovers
    if (this.wasPriceAboveSMA && !isPriceAboveSMA) {
      // Price crossed below SMA => SMA crossed UP the price => SELL
      log('info', `SMA crossed UP price (${sma.toFixed(5)} > ${price.toFixed(5)}) => SELL`);
      createOrder({ type: 'MARKET', side: 'SELL' });
    } else if (!this.wasPriceAboveSMA && isPriceAboveSMA) {
      // Price crossed above SMA => SMA crossed DOWN the price => BUY
      log('info', `SMA crossed DOWN price (${sma.toFixed(5)} < ${price.toFixed(5)}) => BUY`);
      createOrder({ type: 'MARKET', side: 'BUY' });
    }

    this.wasPriceAboveSMA = isPriceAboveSMA;
  }

  log({ candle, tools }: OnCandleEventParams<SMACrossoverStrategyParams>, ...indicators: unknown[]): void {
    const { log } = tools;
    const [sma] = indicators;
    if (!isNumber(sma)) return;

    log('debug', `SMA: ${sma.toFixed(5)} | Price: ${candle.close.toFixed(5)}`);
  }

  // NOT USED
  onEachTimeframeCandle(_params: OnCandleEventParams<SMACrossoverStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCompleted(_params: OnOrderCompletedEventParams<SMACrossoverStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderCanceled(_params: OnOrderCanceledEventParams<SMACrossoverStrategyParams>, ..._indicators: unknown[]): void {}
  onOrderErrored(_params: OnOrderErroredEventParams<SMACrossoverStrategyParams>, ..._indicators: unknown[]): void {}
  end(): void {}
}
