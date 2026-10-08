import { StrategyOrder } from '@models/advice.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { PositionTracker } from './positionTracker';
import { OrderRecorder, playSteps, relayOrderOutcome, UNKNOWN_ORDER_ID } from './positionTracker.mock';

const symbol = 'BTC/USDT';
const ORDER_ID: UUID = '00000000-0000-0000-0000-000000000042';

describe('PositionTracker', () => {
  let tracker: PositionTracker;
  let orders: OrderRecorder;

  /**
   * Plays the steps (see playSteps): 'buy' and 'sell' place an order through the tracker, 'stop' is the SELL of a trailing stop, which
   * the StrategyManager creates and the tracker adopts, 'unadopted' such a SELL left unadopted
   */
  const play = (steps: string) =>
    playSteps(steps, tracker, orders, step => {
      if (step === 'buy') tracker.buy(orders.createOrder, { type: 'STICKY', symbol });
      else if (step === 'sell') tracker.sell(orders.createOrder, { type: 'STICKY', symbol });
      else if (step === 'stop') tracker.adoptSell(orders.createOrder({ type: 'MARKET', side: 'SELL', symbol }));
      else if (step === 'unadopted') orders.createOrder({ type: 'MARKET', side: 'SELL', symbol });
      else throw new Error(`Unknown step: ${step}`);
    });

  beforeEach(() => {
    tracker = new PositionTracker();
    orders = new OrderRecorder();
  });

  describe('position', () => {
    it.each`
      case                                                          | steps                                                | isLong   | isPendingOrder
      ${'nothing placed: flat'}                                     | ${''}                                                | ${false} | ${false}
      ${'a BUY placed: flat, the BUY pending'}                      | ${'buy'}                                             | ${false} | ${true}
      ${'a BUY completed: long'}                                    | ${'buy completed:1'}                                 | ${true}  | ${false}
      ${'a BUY canceled: flat'}                                     | ${'buy canceled:1'}                                  | ${false} | ${false}
      ${'a BUY errored: flat'}                                      | ${'buy errored:1'}                                   | ${false} | ${false}
      ${'a SELL placed: long, the SELL pending'}                    | ${'buy completed:1 sell'}                            | ${true}  | ${true}
      ${'a SELL completed: flat'}                                   | ${'buy completed:1 sell completed:2'}                | ${false} | ${false}
      ${'a SELL canceled: long'}                                    | ${'buy completed:1 sell canceled:2'}                 | ${true}  | ${false}
      ${'a SELL errored: long'}                                     | ${'buy completed:1 sell errored:2'}                  | ${true}  | ${false}
      ${'another order completed: the BUY still pending'}           | ${'buy completed:unknown'}                           | ${false} | ${true}
      ${'another order canceled: the BUY still pending'}            | ${'buy canceled:unknown'}                            | ${false} | ${true}
      ${'another order errored: the BUY still pending'}             | ${'buy errored:unknown'}                             | ${false} | ${true}
      ${'another order completed: the SELL still pending'}          | ${'buy completed:1 sell completed:unknown'}          | ${true}  | ${true}
      ${'the BUY reported completed again: the SELL still pending'} | ${'buy completed:1 sell completed:1'}                | ${true}  | ${true}
      ${'a BUY canceled, then reported completed: flat'}            | ${'buy canceled:1 completed:1'}                      | ${false} | ${false}
      ${'a SELL errored, then reported completed: long'}            | ${'buy completed:1 sell errored:2 completed:2'}      | ${true}  | ${false}
      ${'a stop SELL adopted: long, the SELL pending'}              | ${'buy completed:1 stop'}                            | ${true}  | ${true}
      ${'a stop SELL completed: flat'}                              | ${'buy completed:1 stop completed:2'}                | ${false} | ${false}
      ${'a stop SELL canceled: long'}                               | ${'buy completed:1 stop canceled:2'}                 | ${true}  | ${false}
      ${'a stop SELL errored: long'}                                | ${'buy completed:1 stop errored:2'}                  | ${true}  | ${false}
      ${'a stop SELL not adopted, completed: still long'}           | ${'buy completed:1 unadopted completed:2'}           | ${true}  | ${false}
      ${'its own SELL completed beside a stop SELL: flat, pending'} | ${'buy completed:1 sell stop completed:2'}           | ${false} | ${true}
      ${'a stop SELL completed, then its own SELL refused: flat'}   | ${'buy completed:1 sell stop completed:3 errored:2'} | ${false} | ${false}
    `('tracks $case', ({ steps, isLong, isPendingOrder }) => {
      play(steps);
      expect({ isLong: tracker.isLong, isPendingOrder: tracker.isPendingOrder }).toEqual({ isLong, isPendingOrder });
    });
  });

  describe('canBuy and canSell', () => {
    it.each`
      case                           | steps                     | canBuy   | canSell
      ${'flat, nothing pending'}     | ${''}                     | ${true}  | ${false}
      ${'flat, a BUY pending'}       | ${'buy'}                  | ${false} | ${false}
      ${'flat, a stop SELL pending'} | ${'stop'}                 | ${false} | ${false}
      ${'long, nothing pending'}     | ${'buy completed:1'}      | ${false} | ${true}
      ${'long, a SELL pending'}      | ${'buy completed:1 sell'} | ${false} | ${false}
    `('allows a BUY ($canBuy) and a SELL ($canSell) when $case', ({ steps, canBuy, canSell }) => {
      play(steps);
      expect({ canBuy: tracker.canBuy(), canSell: tracker.canSell() }).toEqual({ canBuy, canSell });
    });
  });

  describe('order hooks', () => {
    it.each`
      outcome        | order                         | steps                          | n            | isOwn
      ${'completed'} | ${'its BUY'}                  | ${'buy'}                       | ${1}         | ${true}
      ${'canceled'}  | ${'its BUY'}                  | ${'buy'}                       | ${1}         | ${true}
      ${'errored'}   | ${'its BUY'}                  | ${'buy'}                       | ${1}         | ${true}
      ${'completed'} | ${'its SELL'}                 | ${'buy completed:1 sell'}      | ${2}         | ${true}
      ${'completed'} | ${'an adopted stop SELL'}     | ${'buy completed:1 stop'}      | ${2}         | ${true}
      ${'completed'} | ${'another order'}            | ${'buy'}                       | ${'unknown'} | ${false}
      ${'canceled'}  | ${'another order'}            | ${'buy'}                       | ${'unknown'} | ${false}
      ${'errored'}   | ${'another order'}            | ${'buy'}                       | ${'unknown'} | ${false}
      ${'completed'} | ${'an order already settled'} | ${'buy completed:1'}           | ${1}         | ${false}
      ${'canceled'}  | ${'an order already settled'} | ${'buy canceled:1'}            | ${1}         | ${false}
      ${'errored'}   | ${'an order already settled'} | ${'buy errored:1'}             | ${1}         | ${false}
      ${'completed'} | ${'a stop SELL not adopted'}  | ${'buy completed:1 unadopted'} | ${2}         | ${false}
    `('says whether $order, $outcome, was its own ($isOwn)', ({ outcome, steps, n, isOwn }) => {
      play(steps);
      expect(relayOrderOutcome(tracker, outcome, n === 'unknown' ? UNKNOWN_ORDER_ID : orders.ids[n - 1])).toBe(isOwn);
    });
  });

  describe('buy and sell', () => {
    let createOrder: Mock<(order: StrategyOrder) => UUID>;

    beforeEach(() => {
      createOrder = vi.fn((_order: StrategyOrder) => ORDER_ID);
    });

    it.each`
      action    | order                                                                           | created
      ${'buy'}  | ${{ type: 'STICKY', symbol }}                                                   | ${{ type: 'STICKY', symbol, side: 'BUY' }}
      ${'buy'}  | ${{ type: 'LIMIT', symbol, amount: 2, price: 90, trailing: { percentage: 5 } }} | ${{ type: 'LIMIT', symbol, amount: 2, price: 90, trailing: { percentage: 5 }, side: 'BUY' }}
      ${'sell'} | ${{ type: 'MARKET', symbol }}                                                   | ${{ type: 'MARKET', symbol, side: 'SELL' }}
      ${'sell'} | ${{ type: 'LIMIT', symbol, amount: 2, price: 110 }}                             | ${{ type: 'LIMIT', symbol, amount: 2, price: 110, side: 'SELL' }}
    `('$action creates the order once, as given, with its side: $created', ({ action, order, created }) => {
      tracker[action as 'buy' | 'sell'](createOrder, order);
      expect(createOrder.mock.calls).toStrictEqual([[created]]);
    });

    it.each`
      action
      ${'buy'}
      ${'sell'}
    `('$action returns the id of the order created', ({ action }) => {
      expect(tracker[action as 'buy' | 'sell'](createOrder, { type: 'MARKET', symbol })).toBe(ORDER_ID);
    });
  });
});
