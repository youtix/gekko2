import { PluginError } from '@errors/plugin/plugin.error';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { Portfolio } from '@models/types/portfolio.types';
import { TradeInitiated } from '@models/types/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_INITIATED_EVENT,
  TRIGGER_ABORTED_EVENT,
  TRIGGER_CREATED_EVENT,
  TRIGGER_FIRED_EVENT,
} from '@plugins/plugin.const';
import { ActiveStopTrigger } from '@plugins/plugin.types';
import { TrailingStop } from '@services/core/order/trailingStop';
import { logger } from '@services/logger';
import Big from 'big.js';
import { addMinutes } from 'date-fns';
import { filter } from 'lodash-es';
import { paperTraderSchema } from './paperTrader.schema';
import { PapertraderConfig, Position } from './paperTrader.types';

export class PaperTrader extends Plugin {
  private activeStopTrigger?: ActiveStopTrigger;
  private balance: number;
  private candle?: Candle;
  private exposed: boolean;
  private fee: number;
  private portfolio: Portfolio;
  private price: number;
  private propogatedTrades: number;
  private propogatedTriggers: number;
  private rawFee: number;
  private trades: number;
  private tradeId?: string;
  public warmupCandle?: Candle;
  private warmupCompleted: boolean;

  constructor({ feeUsing, feeMaker, feeTaker, simulationBalance }: PapertraderConfig) {
    super(PaperTrader.name);
    this.balance = NaN;
    this.rawFee = feeUsing === 'maker' ? feeMaker : feeTaker;
    this.fee = +Big(1).minus(Big(this.rawFee).div(100));
    this.portfolio = { ...simulationBalance };
    this.exposed = this.portfolio.asset > 0;
    this.price = 0;
    this.propogatedTrades = 0;
    this.propogatedTriggers = 0;
    this.trades = 0;
    this.warmupCompleted = false;
  }

  // --- BEGIN LISTENERS ---
  public onStrategyWarmupCompleted() {
    this.warmupCompleted = true;
    if (!this.warmupCandle)
      throw new PluginError(this.pluginName, 'No warmup candle on strategy warmup completed event');
    this.processCandle(this.warmupCandle);
  }

  public onAdvice(advice: Advice) {
    if (advice.recommendation === 'short') {
      // clean up potential old stop trigger
      if (this.activeStopTrigger) {
        this.deferredEmit(TRIGGER_ABORTED_EVENT, {
          id: this.activeStopTrigger.id,
          date: advice.date,
        });

        this.activeStopTrigger = undefined;
      }
    } else if (advice.recommendation === 'long') {
      if (advice.trigger) {
        // clean up potential old stop trigger
        if (this.activeStopTrigger) {
          this.deferredEmit(TRIGGER_ABORTED_EVENT, {
            id: this.activeStopTrigger.id,
            date: advice.date,
          });

          this.activeStopTrigger = undefined;
        }

        this.createTrigger(advice);
      }
    } else {
      logger.warn(`[Papertrader] ignoring unknown advice recommendation: ${advice.recommendation}`);
      return;
    }

    this.tradeId = `trade-${++this.propogatedTrades}`;
    const action = advice.recommendation === 'short' ? 'sell' : 'buy';

    this.deferredEmit<TradeInitiated>(TRADE_INITIATED_EVENT, {
      id: this.tradeId,
      adviceId: advice.id,
      action,
      portfolio: this.portfolio,
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

  // --- BEGIN PROCESSORS ---
  protected processCandle(candle: Candle): void {
    if (this.warmupCompleted) {
      this.price = candle.close;
      this.candle = candle;

      if (!this.balance) {
        this.balance = this.getBalance();
        this.emitPortfolioChangeEvent();
        this.emitPortfolioValueChangeEvent();
      }
      if (this.exposed) this.emitPortfolioValueChangeEvent();
      if (this.activeStopTrigger) this.activeStopTrigger.instance.updatePrice(this.price);
    } else {
      this.warmupCandle = candle;
    }
  }

  protected processFinalize(): void {
    // Nothing to do in this plugin
  }
  // --- END PROCESSORS ---

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

  private createTrigger(advice: Advice) {
    const trigger = advice.trigger;

    if (trigger && trigger.type === 'trailingStop') {
      if (!trigger.trailValue) {
        return logger.warn('[Papertrader] ignoring trailing stop without trail value');
      }

      const triggerId = `trigger-${++this.propogatedTriggers}`;

      this.deferredEmit(TRIGGER_CREATED_EVENT, {
        id: triggerId,
        at: advice.date,
        type: 'trailingStop',
        proprties: {
          trail: trigger.trailValue,
          initialPrice: this.price,
        },
      });

      this.activeStopTrigger = {
        id: triggerId,
        adviceId: advice.id,
        instance: new TrailingStop({
          initialPrice: this.price,
          trail: trigger.trailValue,
          onTrigger: this.stopTrigger,
        }),
      };
    } else {
      logger.warn(`[Papertrader] Gekko does not know trigger with type "${trigger?.type}".. Ignoring stop.`);
    }
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

  private stopTrigger() {
    if (!this.candle) throw new PluginError(this.pluginName, 'No candle on stop trigger event');

    const date = addMinutes(this.candle.start, 1).getTime();

    this.deferredEmit(TRIGGER_FIRED_EVENT, {
      id: this.activeStopTrigger?.id,
      date,
    });

    const { cost, amount, effectivePrice } = this.updatePosition('short');

    this.emitPortfolioChangeEvent();
    this.emitPortfolioValueChangeEvent();

    this.deferredEmit(TRADE_COMPLETED_EVENT, {
      id: this.tradeId,
      adviceId: this.activeStopTrigger?.adviceId,
      action: 'sell',
      cost,
      amount,
      price: this.price,
      portfolio: this.portfolio,
      balance: this.getBalance(),
      date,
      effectivePrice,
      feePercent: this.rawFee,
    });

    this.activeStopTrigger = undefined;
  }
  // --- END INTERNALS ---

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
        TRIGGER_ABORTED_EVENT,
        TRIGGER_CREATED_EVENT,
        TRIGGER_FIRED_EVENT,
      ],
      name: 'PaperTrader',
    };
  }
}
