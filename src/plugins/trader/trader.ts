import { Plugin } from '@plugins/plugin';
import { wait } from '@utils/process/process.utils';
import Big from 'big.js';
import { bindAll, filter } from 'lodash-es';
import {
  PORTFOLIO_CHANGE_EVENT,
  PORTFOLIO_VALUE_CHANGE_EVENT,
  SYNCHRONIZATION_INTERVAL_IN_MS,
} from './trader.const';
import { traderSchema } from './trader.schema';

export class Trader extends Plugin {
  private propogatedTrades: number;
  private propogatedTriggers: number;
  private cancellingOrder: boolean;
  private sendInitialPortfolio: boolean;
  private portfolio: { asset: number; currency: number };
  private balance: number;
  private price: number;
  private exposure: number;
  private exposed: boolean;

  constructor() {
    super(Trader.name);
    this.propogatedTriggers = 0;
    this.propogatedTrades = 0;
    this.cancellingOrder = false;
    this.sendInitialPortfolio = false;
    this.portfolio = { asset: 0, currency: 0 };
    this.balance = 0;
    this.price = 0;
    this.exposure = 0;
    this.exposed = false;

    bindAll(this, ['synchronize']);

    setInterval(this.synchronize, SYNCHRONIZATION_INTERVAL_IN_MS);
  }

  private async synchronize() {
    const broker = this.getBroker();
    const sleepInterval = broker.getInterval();
    // const ticker = broker.getTicker();
    await wait(sleepInterval);
    // TODO: Broker get Fee
    await wait(sleepInterval);
    // TODO: Broker get Balances
    await wait(sleepInterval);

    // TODO: sync
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

  private setPortfolio() {
    // TODO: call broker to check portfolio balance
  }

  private setBalance() {
    this.balance = +Big(this.price).mul(this.portfolio.asset).plus(this.portfolio.currency);
    this.exposure = +Big(this.portfolio.asset).mul(this.price).div(this.balance);
    // if more than 10% of balance is in asset we are exposed
    this.exposed = this.exposure > 0.1;
  }

  protected processCandle(): void {
    throw new Error('Method not implemented.');
  }

  protected processFinalize(): void {
    throw new Error('Method not implemented.');
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
