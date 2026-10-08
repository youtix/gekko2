import { AdviceOrder, StrategyOrder } from '@models/advice.types';
import { Portfolio } from '@models/portfolio.types';
import { TradingPair } from '@models/utility.types';
import { MarketData } from '@services/exchange/exchange.types';
import { noop, pick } from 'lodash-es';
import { UUID } from 'node:crypto';
import { LoggerFn, OnOrderCanceledEventParams, OnOrderCompletedEventParams, OnOrderErroredEventParams, Strategy } from './strategy.types';

export type OrderOutcome = 'completed' | 'canceled' | 'errored';
/** A strategy's order hooks, or those of a PositionTracker */
type OrderHooks<T> = Pick<Strategy<T>, 'onOrderCompleted' | 'onOrderCanceled' | 'onOrderErrored'>;
/** An order as the events of its outcome describe it: its id, and what the Trader relays with it */
type RelayedOrder = Pick<AdviceOrder, 'id'> & Partial<Omit<AdviceOrder, 'id' | 'orderCreationDate'>>;

/**
 * What the event of an outcome reports besides its order. Each part left out reports nothing of an execution, as the Trader relays
 * an order canceled without its fill (0 filled, 0 remaining) before it ever read the portfolio (empty), the price unknown (0), on a
 * market without minimums.
 */
export type OutcomeFacts = {
  /** What a cancelation reports filled; given as undefined, the event misses it, as the order leaves out an amount it does not know */
  filled?: number;
  /** What a cancelation reports remaining; given as undefined, the event misses it */
  remaining?: number;
  /** The portfolio after the order */
  portfolio?: Portfolio;
  /** The price of the order's pair */
  price?: number;
  /** tools.marketData */
  marketData?: Map<TradingPair, MarketData>;
  /** tools.log */
  log?: LoggerFn;
};

/** The id of an order the strategy did not create, relayed by the step '<outcome>:unknown' */
export const UNKNOWN_ORDER_ID: UUID = 'ffffffff-ffff-ffff-ffff-ffffffffffff';

/** A portfolio holding `free` of the asset of `symbol`, and `used` reserved by an order, as the Trader reads it after an order */
export const holding = (symbol: TradingPair, free: number, used = 0): Portfolio => {
  const [asset] = symbol.split('/');
  return new Map([[asset, { free, used, total: free + used }]]);
};

/**
 * Stands in for tools.createOrder: records every order created, an all-in one (without amount) with amount 1, and gives the n-th
 * one the id 00000000-0000-0000-0000-00000000000n.
 */
export class OrderRecorder {
  readonly advices: StrategyOrder[] = [];
  readonly ids: UUID[] = [];

  readonly createOrder = (order: StrategyOrder): UUID => {
    this.advices.push({ ...order, amount: order.amount ?? 1 });
    const id = `00000000-0000-0000-0000-${String(this.advices.length).padStart(12, '0')}` as UUID;
    this.ids.push(id);
    return id;
  };

  /** The n-th order created, from 1, as the events of its outcome describe it; undefined when there is none */
  created(n: number): RelayedOrder | undefined {
    const advice = this.advices[n - 1];
    if (!advice) return undefined;
    const { symbol, side, type, amount, price } = advice;
    return { id: this.ids[n - 1], symbol, side, type, amount, price };
  }
}

/** Relays the outcome of an order to the order hook, with what its event reports besides (see OutcomeFacts); returns what it returns */
export const relayOrderOutcome = <T>(
  target: OrderHooks<T>,
  outcome: OrderOutcome,
  order: RelayedOrder,
  facts: OutcomeFacts = {},
): unknown => {
  const { portfolio = new Map(), price = 0, marketData = new Map(), log = noop } = facts;
  const exchange = { portfolio, price };
  const tools = { marketData, log };
  switch (outcome) {
    case 'completed':
      return target.onOrderCompleted?.({ order, exchange, tools } as unknown as OnOrderCompletedEventParams<T>);
    case 'canceled': {
      const params = { order: { ...order, filled: 0, remaining: 0, ...pick(facts, 'filled', 'remaining') }, exchange, tools };
      return target.onOrderCanceled?.(params as unknown as OnOrderCanceledEventParams<T>);
    }
    case 'errored':
      return target.onOrderErrored?.({ order, exchange, tools } as unknown as OnOrderErroredEventParams<T>);
    default:
      throw new Error(`Unknown order outcome: ${outcome}`);
  }
};

/**
 * Plays the steps, separated by spaces: '<outcome>:<n>' relays the outcome (completed, canceled, errored) of the n-th order the
 * recorder gave an id, its event reporting nothing of an execution (see OutcomeFacts), '<outcome>:<n>:<free>' with a portfolio
 * holding <free> of the order's asset after it, '<outcome>:unknown' that of an order the strategy did not create, and playStep plays
 * any other step (a candle).
 */
export const playSteps = <T>(steps: string, target: OrderHooks<T>, orders: OrderRecorder, playStep: (step: string) => void): void => {
  for (const step of steps.split(' ').filter(Boolean)) {
    const [kind, n, free] = step.split(':');
    if (!n) {
      playStep(kind);
      continue;
    }
    const order = n === 'unknown' ? { id: UNKNOWN_ORDER_ID } : orders.created(Number(n));
    if (!order) throw new Error(`No order ${n} to relay the outcome of, in "${steps}"`);
    if (free === undefined) {
      relayOrderOutcome(target, kind as OrderOutcome, order);
      continue;
    }
    if (!order.symbol || !/^\d+(\.\d+)?$/.test(free)) throw new Error(`No portfolio holding "${free}" after order ${n}, in "${steps}"`);
    relayOrderOutcome(target, kind as OrderOutcome, order, { portfolio: holding(order.symbol, Number(free)) });
  }
};
