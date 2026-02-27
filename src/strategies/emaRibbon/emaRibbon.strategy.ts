import { TradingPair } from '@models/utility.types';
import {
  IndicatorResults,
  InitParams,
  OnCandleEventParams,
  OnOrderCanceledEventParams,
  OnOrderCompletedEventParams,
  OnOrderErroredEventParams,
  Strategy,
} from '@strategies/strategy.types';
import { UUID } from 'crypto';
import type { EMARibbonStrategyParams } from './emaRibbon.types';

export class EMARibbon implements Strategy<EMARibbonStrategyParams> {
  private isLong: boolean = false;
  private pair?: TradingPair;
  private buyOrderId?: UUID;
  private sellOrderId?: UUID;
  private isPendingOrder: boolean = false;
  private lastSpreadValue?: number;

  init({ candle, tools, addIndicator }: InitParams<EMARibbonStrategyParams>): void {
    const [pair] = candle.keys();
    this.pair = pair;
    const { src, count, start, step } = tools.strategyParams;
    addIndicator('EMARibbon', this.pair, { src, count, start, step });
  }

  onTimeframeCandleAfterWarmup(
    { tools }: OnCandleEventParams<EMARibbonStrategyParams>,
    ...indicators: IndicatorResults<{ results: number[]; spread: number } | null>[]
  ): void {
    const [emaRibbon] = indicators;
    const { createOrder, strategyParams } = tools;
    const { spreadCompressionThreshold } = strategyParams;
    if (!this.pair || emaRibbon.results === undefined || emaRibbon.results === null) return;

    // A bullish signal occurs when the EMA ribbon is ordered in DESC order (each faster EMA is above the slower one).
    const isBullish = emaRibbon.results.results.every((result, index, values) => !index || values[index - 1] > result);
    const isSpreadCompressed = emaRibbon.results.spread < spreadCompressionThreshold;
    const isSpreadCompressing = this.lastSpreadValue !== undefined && emaRibbon.results.spread < this.lastSpreadValue;

    // console.log(emaRibbon.results.spread);

    if (!this.isLong && isBullish && isSpreadCompressed && !this.isPendingOrder) {
      this.buyOrderId = createOrder({ type: 'STICKY', side: 'BUY', symbol: this.pair });
      this.isPendingOrder = true;
    }

    if (this.isLong && isSpreadCompressing && !this.isPendingOrder) {
      this.sellOrderId = createOrder({ type: 'STICKY', side: 'SELL', symbol: this.pair });
      this.isPendingOrder = true;
    }

    this.lastSpreadValue = emaRibbon.results.spread;
  }

  log(
    { tools }: OnCandleEventParams<EMARibbonStrategyParams>,
    ...indicators: IndicatorResults<{ results: number[]; spread: number } | null>[]
  ): void {
    const { log } = tools;
    const [emaRibbon] = indicators;
    if (emaRibbon.results === undefined || emaRibbon.results === null) return;
    log('debug', `Ribbon results: [${emaRibbon.results.results.join(' / ')}]`);
    log('debug', `Ribbon Spread: ${emaRibbon.results.spread}`);
  }

  onOrderCompleted(params: OnOrderCompletedEventParams<EMARibbonStrategyParams>, ..._indicators: IndicatorResults[]): void {
    if (params.order.id === this.sellOrderId) {
      this.isLong = false;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    } else if (params.order.id === this.buyOrderId) {
      this.isLong = true;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    }
  }

  onOrderCanceled(params: OnOrderCanceledEventParams<EMARibbonStrategyParams>, ..._indicators: IndicatorResults[]): void {
    if (params.order.id === this.buyOrderId) {
      this.isLong = false;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (params.order.id === this.sellOrderId) {
      this.isLong = true;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }

  onOrderErrored(params: OnOrderErroredEventParams<EMARibbonStrategyParams>, ..._indicators: IndicatorResults[]): void {
    if (params.order.id === this.buyOrderId) {
      this.isLong = false;
      this.buyOrderId = undefined;
      this.isPendingOrder = false;
    } else if (params.order.id === this.sellOrderId) {
      this.isLong = true;
      this.sellOrderId = undefined;
      this.isPendingOrder = false;
    }
  }
}
