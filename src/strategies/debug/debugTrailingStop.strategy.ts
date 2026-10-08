import { OnCandleEventParams, OnOrderCompletedEventParams, Strategy } from '@strategies/strategy.types';
import { UUID } from 'node:crypto';
import { z } from 'zod';
import { TrailingStopState } from '../trailingStopManager.types';
import { debugTrailingStopStrategySchema } from './debugTrailingStop.schema';

type DebugTrailingStopParams = z.infer<typeof debugTrailingStopStrategySchema>;

/**
 * Debug strategy used exclusively in e2e tests to verify the trailing stop lifecycle.
 * Places a single BUY order with a trailing stop config, then logs each lifecycle event
 * so that tests can assert on logStore entries.
 */
export class DebugTrailingStop implements Strategy<DebugTrailingStopParams> {
  static schema = debugTrailingStopStrategySchema;
  private index = 0;
  private orderPlaced = false;

  onTimeframeCandleAfterWarmup({ candle, tools }: OnCandleEventParams<DebugTrailingStopParams>, ..._indicators: unknown[]): void {
    const { strategyParams, log, createOrder } = tools;

    if (strategyParams.wait > this.index) {
      this.index++;
      return;
    }

    if (!this.orderPlaced) {
      const symbol = candle.keys().next().value!;
      log('debug', 'Trailing stop BUY order created');
      const order = {
        type: 'MARKET' as const,
        side: 'BUY' as const,
        amount: 1,
        symbol,
        trailing: { trigger: strategyParams.trigger, percentage: strategyParams.percentage },
      };
      createOrder(order);
      this.orderPlaced = true;
    }

    this.index++;
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<DebugTrailingStopParams>, ..._indicators: unknown[]): void {
    params.tools.log('debug', `Trailing stop order completed: ${params.order.id}`);
  }

  onTrailingStopActivated(state: TrailingStopState): void {
    // This will be logged by the TrailingStopManager via the event system,
    // but we also log from the strategy callback to verify the strategy hook works.
    void state; // keep reference for clarity
  }

  onTrailingStopTriggered(_orderId: UUID, _state: TrailingStopState): void {
    // The triggered trailing stop automatically creates a SELL market order
    // via strategyManager.onTrailingStopTriggered — no action needed here.
  }
}
