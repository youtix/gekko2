import { Action } from '@models/types/action.types';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { Portfolio } from '@models/types/portfolio.types';
import { Plugin } from '@plugins/plugin';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_INITIATED_EVENT,
  TRIGGER_ABORTED_EVENT,
  TRIGGER_FIRED_EVENT,
} from '@plugins/plugin.const';
import { ActiveStopTrigger } from '@plugins/plugin.types';
import { logger } from '@services/logger';
import { wait } from '@utils/process/process.utils';
import Big from 'big.js';
import { Order } from 'ccxt';
import { bindAll, filter, isEqual } from 'lodash-es';
import { SYNCHRONIZATION_INTERVAL, TRADE_ABORTED_EVENT } from './trader.const';
import { traderSchema } from './trader.schema';

export class Trader extends Plugin {
  private activeStopTrigger?: ActiveStopTrigger;
  private propogatedTrades: number;
  private propogatedTriggers: number;
  private cancellingOrder: boolean;
  private sendInitialPortfolio: boolean;
  private portfolio: Portfolio;
  private balance: number;
  private price: number;
  private exposure: number;
  private exposed: boolean;
  private order?: Order;

  constructor() {
    super(Trader.name);
    this.propogatedTriggers = 0;
    this.propogatedTrades = 0;
    this.cancellingOrder = false;
    this.sendInitialPortfolio = false;
    this.portfolio = { asset: 0, currency: 0 };
    this.balance = 0;
    this.exposure = 0;
    this.price = 0;
    this.exposed = false;

    bindAll(this, ['synchronize']);

    setInterval(this.synchronize, SYNCHRONIZATION_INTERVAL);
  }

  private async synchronize() {
    const broker = this.getBroker();
    const sleepInterval = broker.getInterval();
    const ticker = await broker.fetchTicker();
    await wait(sleepInterval);
    // TODO: Broker get Fee ?
    await wait(sleepInterval);
    const oldPortfolio = this.portfolio;
    this.portfolio = await broker.fetchPortfolio();
    if (!this.price) this.price = ticker.bid;
    this.setBalance();
    if (this.sendInitialPortfolio && !isEqual(oldPortfolio, this.portfolio))
      this.emitPortfolioChangeEvent();
  }

  private emitPortfolioChangeEvent() {
    this.deferredEmit(PORTFOLIO_CHANGE_EVENT, {
      asset: this.portfolio.asset,
      currency: this.portfolio.currency,
    });
  }

  private emitPortfolioValueChangeEvent() {
    this.deferredEmit(PORTFOLIO_VALUE_CHANGE_EVENT, {
      balance: this.balance,
    });
  }

  private setBalance() {
    this.balance = +Big(this.price).mul(this.portfolio.asset).plus(this.portfolio.currency);
    this.exposure = +Big(this.portfolio.asset).mul(this.price).div(this.balance);
    // if more than 10% of balance is in asset we are exposed
    this.exposed = this.exposure > 0.1;
  }

  public processCandle(candle: Candle): void {
    this.price = candle.close;
    const previousBalance = this.balance;
    // TODO: need to setPortfolio ?
    this.setBalance();

    if (!this.sendInitialPortfolio) {
      this.sendInitialPortfolio = true;
      this.deferredEmit(PORTFOLIO_CHANGE_EVENT, {
        asset: this.portfolio.asset,
        currency: this.portfolio.currency,
      });
    }

    if (this.balance !== previousBalance) {
      // this can happen because:
      // A) the price moved and we have > 0 asset
      // B) portfolio got changed
      this.emitPortfolioValueChangeEvent();
    }
  }

  public processFinalize(): void {
    // Nothing to do in this plugin
  }

  public onAdvice(advice: Advice) {
    if (!['long', 'short'].includes(advice.recommendation)) {
      logger.error('[Trader] Ignoring advice in unknown direction');
      return;
    }
    const direction = advice.recommendation === 'long' ? 'buy' : 'sell';
    const id = 'trade-' + ++this.propogatedTrades;

    if (this.order) {
      if (this.order?.side === direction) {
        logger.info(`[Trader] Ignoring advice: already in the process to ${direction}`);
        return;
      }

      if (this.cancellingOrder) {
        logger.info(
          `[Trader] Ignoring advice: already cancelling previous ${this.order.side} order`,
        );
        return;
      }

      logger.info(
        [
          `[Trader] Received advice to ${direction}`,
          `however Gekko is already in the process to ${this.order.side}.`,
          `Canceling ${this.order.side} order first`,
        ].join(' '),
      );

      this.cancelOrder(id, advice, () => this.onAdvice(advice));
      return;
    }

    if (direction === 'buy') {
      if (this.exposed) {
        logger.info('[Trader] NOT buying, already exposed');
        return this.deferredEmit(TRADE_ABORTED_EVENT, {
          id,
          adviceId: advice.id,
          action: direction,
          portfolio: this.portfolio,
          balance: this.balance,
          reason: 'Portfolio already in position.',
        });
      }

      logger.info(`[Trader] Received advice to go long. Buying ${this.asset}`);
    }

    if (direction === 'sell') {
      if (!this.exposed) {
        logger.info('[Trader] NOT selling, already no exposure');
        return this.deferredEmit(TRADE_ABORTED_EVENT, {
          id,
          adviceId: advice.id,
          action: direction,
          portfolio: this.portfolio,
          balance: this.balance,
          reason: 'Portfolio already in position.',
        });
      }

      // clean up potential old stop trigger
      if (this.activeStopTrigger) {
        this.deferredEmit(TRIGGER_ABORTED_EVENT, {
          id: this.activeStopTrigger.id,
          date: advice.date,
        });

        this.activeStopTrigger.instance.cancel();

        this.activeStopTrigger = undefined;
      }

      logger.info(`[Trader] Received advice to go short. Selling ${this.asset}`);
    }

    const amount =
      direction === 'buy' ? (this.portfolio.currency / this.price) * 0.95 : this.portfolio.asset;

    this.createOrder(direction, amount, advice, id);
  }

  private stopTrigger(price: number) {
    logger.info(
      `[Trader] TrailingStop trigger "${this.activeStopTrigger?.id}" fired! Observed price was ${price}`,
    );

    this.deferredEmit(TRIGGER_FIRED_EVENT, {
      id: this.activeStopTrigger?.id,
      date: Date.now(),
    });

    const adviceId = this.activeStopTrigger?.adviceId ?? '';
    this.activeStopTrigger = undefined;
    this.onAdvice({ recommendation: 'short', id: adviceId });
  }

  private cancelOrder(id: string, advice: Advice, callback: () => void) {}

  private async createOrder(side: Action, amount: number, advice: Advice, id: string) {
    logger.debug('[TRADER] Creating order to', side, amount, this.asset);
    this.deferredEmit(TRADE_INITIATED_EVENT, {
      id,
      adviceId: advice.id,
      action: side,
      portfolio: this.portfolio,
      balance: this.balance,
    });
  }

  public static getStaticConfiguration() {
    return {
      schema: traderSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: ['broker'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Trader.prototype), (p) =>
        p.startsWith('on'),
      ),
      eventsEmitted: [],
      name: Trader.name,
    };
  }
}
