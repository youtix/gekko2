import { PluginError } from '@errors/plugin/plugin.error';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { Nullable } from '@models/types/generic.types';
import { Portfolio } from '@models/types/portfolio.types';
import { TradeInitiated } from '@models/types/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_INITIATED_EVENT,
} from '@plugins/plugin.const';
import { warning } from '@services/logger';
import Big from 'big.js';
import { filter } from 'lodash-es';
import { paperTraderSchema } from './paperTrader.schema';
import { PapertraderConfig, Position } from './paperTrader.types';

export class PaperTrader extends Plugin {
  private balance: Nullable<number>;
  private exposed: boolean;
  private fee: number;
  private portfolio: Portfolio;
  private price: number;
  private propogatedTrades: number;
  private rawFee: number;
  private trades: number;
  private tradeId?: string;
  public warmupCandle?: Candle;
  private warmupCompleted: boolean;

  constructor({ feeUsing, feeMaker, feeTaker, simulationBalance }: PapertraderConfig) {
    super(PaperTrader.name);
    this.balance = null;
    this.rawFee = feeUsing === 'maker' ? feeMaker : feeTaker;
    this.fee = +Big(1).minus(Big(this.rawFee).div(100));
    this.portfolio = { ...simulationBalance };
    this.exposed = this.portfolio.asset > 0;
    this.price = 0;
    this.propogatedTrades = 0;
    this.trades = 0;
    this.warmupCompleted = false;
  }

  // --- BEGIN LISTENERS ---
  public onStrategyWarmupCompleted() {
    this.warmupCompleted = true;
    if (!this.warmupCandle)
      throw new PluginError(this.pluginName, 'No warmup candle on strategy warmup completed event');
    this.processOneMinuteCandle(this.warmupCandle);
  }

  public onStrategyAdvice(advice: Advice) {
    if (!['short', 'long'].includes(advice.recommendation)) {
      warning('paper trader', `Ignoring unknown advice recommendation: ${advice.recommendation}`);
      return;
    }

    // Skip long advice if the portfolio is completely empty (no assets and no currency)
    if (advice.recommendation === 'long' && this.portfolio.asset === 0 && this.portfolio.currency === 0) {
      warning('paper trader', 'Skipping advice: portfolio is completely empty (no assets, no currency).');
      return;
    }

    this.tradeId = `trade-${++this.propogatedTrades}`;
    const action = advice.recommendation === 'short' ? 'sell' : 'buy';

    this.deferredEmit<TradeInitiated>(TRADE_INITIATED_EVENT, {
      id: this.tradeId,
      adviceId: advice.id,
      action,
      portfolio: { ...this.portfolio },
      balance: this.getBalance(),
      date: advice.date,
    });

    const { cost, amount, effectivePrice } = this.updatePosition(advice.recommendation);

    this.emitPortfolioChangeEvent();
    this.emitPortfolioValueChangeEvent();

    this.deferredEmit(TRADE_COMPLETED_EVENT, {
      id: this.tradeId,
      adviceId: advice.id,
      action,
      cost,
      amount,
      price: this.price,
      portfolio: this.portfolio,
      balance: this.getBalance(),
      date: advice.date,
      effectivePrice,
      feePercent: this.rawFee,
    });
  }
  // --- END LISTENERS ---

  // --- BEGIN INTERNALS ---
  private emitPortfolioChangeEvent() {
    this.deferredEmit<Portfolio>(PORTFOLIO_CHANGE_EVENT, {
      asset: this.portfolio.asset,
      currency: this.portfolio.currency,
    });
  }

  private emitPortfolioValueChangeEvent() {
    this.deferredEmit(PORTFOLIO_VALUE_CHANGE_EVENT, {
      balance: this.getBalance(),
    });
  }

  private getBalance() {
    return +Big(this.price).mul(this.portfolio.asset).plus(this.portfolio.currency);
  }

  private updatePosition(recommendation: 'short' | 'long') {
    const result: Position = {};

    if (recommendation === 'long') {
      result.cost = +Big(1).minus(this.fee).mul(this.portfolio.currency);
      this.portfolio.asset += +Big(this.portfolio.currency).div(this.price).mul(this.fee).round(8, Big.roundDown);
      result.amount = this.portfolio.asset;
      this.portfolio.currency = 0;

      this.exposed = true;
      this.trades++;
    } else if (recommendation === 'short') {
      result.cost = +Big(1).minus(this.fee).mul(Big(this.portfolio.asset).mul(this.price));
      this.portfolio.currency += +Big(this.portfolio.asset).mul(this.price).mul(this.fee).round(8, Big.roundDown);
      result.amount = +Big(this.portfolio.currency).div(this.price);
      this.portfolio.asset = 0;

      this.exposed = false;
      this.trades++;
    }

    result.effectivePrice = +Big(this.price).mul(this.fee);

    return result;
  }

  // --- END INTERNALS ---

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processOneMinuteCandle(candle: Candle): void {
    if (this.warmupCompleted) {
      this.price = candle.close;

      if (this.balance === null) {
        this.balance = this.getBalance();
        this.emitPortfolioChangeEvent();
        this.emitPortfolioValueChangeEvent();
      }
      if (this.exposed) this.emitPortfolioValueChangeEvent();
    } else {
      this.warmupCandle = candle;
    }
  }

  protected processFinalize(): void {
    /* noop */
  }

  public static getStaticConfiguration() {
    return {
      schema: paperTraderSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(PaperTrader.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        PORTFOLIO_CHANGE_EVENT,
        PORTFOLIO_VALUE_CHANGE_EVENT,
        TRADE_COMPLETED_EVENT,
        TRADE_INITIATED_EVENT,
      ],
      name: 'PaperTrader',
    };
  }
}
