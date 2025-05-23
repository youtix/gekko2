import { PluginError } from '@errors/plugin/plugin.error';
import { Action } from '@models/types/action.types';
import { Advice } from '@models/types/advice.types';
import { Candle } from '@models/types/candle.types';
import { Portfolio } from '@models/types/portfolio.types';
import { TradeAborted, TradeCanceled, TradeErrored, TradeInitiated } from '@models/types/tradeStatus.types';
import { Plugin } from '@plugins/plugin';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  TRADE_ABORTED_EVENT,
  TRADE_CANCELED_EVENT,
  TRADE_COMPLETED_EVENT,
  TRADE_ERRORED_EVENT,
  TRADE_INITIATED_EVENT,
} from '@plugins/plugin.const';
import {
  ORDER_COMPLETED_EVENT,
  ORDER_ERRORED_EVENT,
  ORDER_PARTIALLY_FILLED_EVENT,
  ORDER_STATUS_CHANGED_EVENT,
} from '@services/core/order/base/baseOrder.const';
import { StickyOrder } from '@services/core/order/sticky/stickyOrder';
import { logger } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { wait } from '@utils/process/process.utils';
import Big from 'big.js';
import { bindAll, filter, isEqual } from 'lodash-es';
import { SYNCHRONIZATION_INTERVAL } from './trader.const';
import { traderSchema } from './trader.schema';

export class Trader extends Plugin {
  private propogatedTrades: number;
  private cancellingOrder: boolean;
  private sendInitialPortfolio: boolean;
  private portfolio: Portfolio;
  private balance: number;
  private price: number;
  private exposure: number;
  private exposed: boolean;
  private order?: StickyOrder;

  constructor() {
    super(Trader.name);
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
    logger.debug(`[TRADER] Synchronizing data with ${broker.getBrokerName()}`);
    if (!this.price) {
      const sleepInterval = broker.getInterval();
      const ticker = await broker.fetchTicker();
      this.price = ticker.bid;
      await wait(sleepInterval);
    }
    const oldPortfolio = this.portfolio;
    this.portfolio = await broker.fetchPortfolio();
    logger.debug(
      `[TRADER] Current portfolio: ${this.portfolio.asset} ${this.asset} / ${this.portfolio.currency} ${this.currency}`,
    );

    this.setBalance();
    if (this.sendInitialPortfolio && !isEqual(oldPortfolio, this.portfolio)) this.emitPortfolioChangeEvent();
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
    if (!this.portfolio.asset && !this.portfolio.currency) return;
    this.balance = +Big(this.price).mul(this.portfolio.asset).plus(this.portfolio.currency);
    this.exposure = +Big(this.portfolio.asset).mul(this.price).div(this.balance);
    // if more than 10% of balance is in asset we are exposed
    this.exposed = this.exposure > 0.1;
  }

  public async processCandle(candle: Candle) {
    this.price = candle.close;
    const previousBalance = this.balance;
    this.setBalance();

    if (!this.sendInitialPortfolio) {
      this.sendInitialPortfolio = true;
      await this.synchronize();
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
      logger.error('[TRADER] Ignoring advice in unknown direction');
      return;
    }
    const direction = advice.recommendation === 'long' ? 'buy' : 'sell';
    const id = `trade-${++this.propogatedTrades}`;

    if (this.order) {
      if (this.order.getSide() === direction) {
        logger.info(`[TRADER] Ignoring advice: already in the process to ${direction}`);
        return;
      }

      if (this.cancellingOrder) {
        logger.info(`[TRADER] Ignoring advice: already cancelling previous ${this.order.getSide()} order`);
        return;
      }

      logger.info(
        [
          `[TRADER] Received advice to ${direction}`,
          `however Gekko is already in the process to ${this.order.getSide()}.`,
          `Canceling ${this.order.getSide()} order first`,
        ].join(' '),
      );

      this.cancelOrder(id, advice, () => this.onAdvice(advice));
      return;
    }

    if (direction === 'buy') {
      if (this.exposed) {
        logger.info('[TRADER] NOT buying, already exposed');
        return this.deferredEmit<TradeAborted>(TRADE_ABORTED_EVENT, {
          id,
          adviceId: advice.id,
          action: direction,
          portfolio: this.portfolio,
          balance: this.balance,
          date: advice.date,
          reason: 'Portfolio already in position.',
        });
      }

      logger.info(`[TRADER] Received advice to go long. Buying ${this.asset}`);
    }

    if (direction === 'sell') {
      if (!this.exposed) {
        logger.info('[TRADER] NOT selling, already no exposure');
        return this.deferredEmit<TradeAborted>(TRADE_ABORTED_EVENT, {
          id,
          adviceId: advice.id,
          action: direction,
          portfolio: this.portfolio,
          balance: this.balance,
          date: advice.date,
          reason: 'Portfolio already in position.',
        });
      }

      logger.info(`[TRADER] Received advice to go short. Selling ${this.asset}`);
    }

    const amount = direction === 'buy' ? (this.portfolio.currency / this.price) * 0.95 : this.portfolio.asset;

    this.createOrder(direction, amount, advice, id);
  }

  private cancelOrder(id: string, advice: Advice, callback: () => void) {
    if (!this.order) return callback();

    this.cancellingOrder = true;

    this.order.removeAllListeners();
    this.order.cancel();
    this.order.once(ORDER_COMPLETED_EVENT, async () => {
      this.order = undefined;
      this.cancellingOrder = false;
      this.deferredEmit<TradeCanceled>(TRADE_CANCELED_EVENT, {
        id,
        adviceId: advice.id,
        date: Date.now(),
      });
      await this.synchronize();
      callback();
    });
  }

  private async createOrder(side: Action, amount: number, advice: Advice, id: string) {
    logger.info(`[TRADER] Creating order to ${side} ${amount} ${this.asset}`);
    this.deferredEmit<TradeInitiated>(TRADE_INITIATED_EVENT, {
      id,
      adviceId: advice.id,
      action: side,
      portfolio: this.portfolio,
      balance: this.balance,
      date: advice.date,
    });
    this.order = new StickyOrder(side, amount, this.getBroker());

    this.order.on(ORDER_PARTIALLY_FILLED_EVENT, filled =>
      logger.info(`[TRADER] partial ${side} fill, total filled: ${filled}`),
    );
    this.order.on(ORDER_STATUS_CHANGED_EVENT, status => logger.debug(`[TRADER] status changed: ${status}`));
    this.order.on(ORDER_ERRORED_EVENT, reason => {
      logger.error(`[TRADER] Gekko received error: ${reason}`);
      this.order = undefined;
      this.cancellingOrder = false;

      this.deferredEmit<TradeErrored>(TRADE_ERRORED_EVENT, { id, adviceId: advice.id, date: Date.now(), reason });
    });
    this.order.on(ORDER_COMPLETED_EVENT, async () => {
      try {
        this.handleOrderCompletedEvent(advice, id);
      } catch (error) {
        if (error instanceof Error) {
          logger.error(`[TRADER] ${error.message}`);
          return this.deferredEmit<TradeErrored>(TRADE_ERRORED_EVENT, {
            id,
            adviceId: advice.id,
            date: Date.now(),
            reason: error.message,
          });
        }
      }
    });
  }

  private processCostAndPrice(side: Action, price: number, amount: number, feePercent?: number) {
    if (feePercent) {
      const cost = +Big(feePercent).div(100).mul(amount).mul(price);
      if (side === 'buy') return { effectivePrice: +Big(price).mul(Big(feePercent).div(100).add(1)), cost };
      else return { effectivePrice: +Big(price).mul(Big(feePercent).div(100).minus(1)), cost };
    }
    logger.warn('WARNING: exchange did not provide fee information, assuming no fees..');
    return { effectivePrice: price, cost: +Big(price).mul(amount) };
  }

  private async handleOrderCompletedEvent(advice: Advice, id: string) {
    if (!this.order) throw new PluginError('trader', 'Missing order when handling order completed event');

    const summary = await this.order.createSummary();

    this.order = undefined;
    await this.synchronize();

    const { amount, price, feePercent, side, date } = summary;
    const { effectivePrice, cost } = this.processCostAndPrice(side, price, amount, feePercent);

    logger.info(
      [
        `[TRADER] ${side} sticky order summary '${id}':`,
        `Completed at: ${date ? toISOString(date) : 'Unknown'},`,
        `Order amount: ${amount},`,
        `Effective price: ${effectivePrice},`,
        `Cost: ${cost},`,
        `Fee percent: ${feePercent},`,
      ].join(' '),
    );

    this.deferredEmit(TRADE_COMPLETED_EVENT, {
      id,
      adviceId: advice.id,
      action: side,
      cost,
      amount: amount,
      price: price,
      portfolio: this.portfolio,
      balance: this.balance,
      date: date,
      feePercent: feePercent,
      effectivePrice,
    });
  }

  public static getStaticConfiguration() {
    return {
      schema: traderSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: ['broker'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Trader.prototype), p => p.startsWith('on')),
      eventsEmitted: [
        PORTFOLIO_CHANGE_EVENT,
        PORTFOLIO_VALUE_CHANGE_EVENT,
        TRADE_ABORTED_EVENT,
        TRADE_CANCELED_EVENT,
        TRADE_COMPLETED_EVENT,
        TRADE_ERRORED_EVENT,
        TRADE_INITIATED_EVENT,
      ],
      name: 'Trader',
    };
  }
}
