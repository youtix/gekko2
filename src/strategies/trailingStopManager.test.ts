import { TRAILING_STOP_ACTIVATED, TRAILING_STOP_TRIGGERED } from '@constants/event.const';
import { CandleBucket } from '@models/event.types';
import { TradingPair } from '@models/utility.types';
import { UUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TrailingStopManager } from './trailingStopManager';
import { TrailingStopState } from './trailingStopManager.types';

/* -------------------------------------------------------------------------- */
/*                                Test Helpers                                */
/* -------------------------------------------------------------------------- */

const makeCandle = (high: number, low: number, close: number) => ({ start: 1000, open: 1, high, low, close, volume: 1 }) as any;

const makeBucket = (symbol: TradingPair, high: number, low: number, close: number): CandleBucket => {
  const bucket: CandleBucket = new Map();
  bucket.set(symbol, makeCandle(high, low, close));
  return bucket;
};

const defaultId = 'aaaa-bbbb-cccc-dddd' as UUID;
const defaultOrder = {
  id: defaultId,
  symbol: 'BTC/USDT' as TradingPair,
  side: 'SELL' as const,
  amount: 0.5,
  trailing: { percentage: 2, trigger: 50000 },
  createdAt: Date.now(),
};

/* -------------------------------------------------------------------------- */
/*                              Unit Tests                                   */
/* -------------------------------------------------------------------------- */

describe('TrailingStopManager', () => {
  let manager: TrailingStopManager;

  beforeEach(() => {
    manager = new TrailingStopManager();
  });

  /* -------------------------------------------------------------------------- */
  /*                                 addOrder                                   */
  /* -------------------------------------------------------------------------- */

  describe('addOrder', () => {
    it.each([
      { desc: 'stores order as dormant', input: defaultOrder, check: (o: any) => expect(o?.status).toBe('dormant') },
      { desc: 'initializes highestPeak to 0', input: defaultOrder, check: (o: any) => expect(o?.highestPeak).toBe(0) },
      { desc: 'initializes stopPrice to 0', input: defaultOrder, check: (o: any) => expect(o?.stopPrice).toBe(0) },
      { desc: 'sets activation price', input: defaultOrder, check: (o: any) => expect(o?.activationPrice).toBe(50000) },
    ])('$desc', ({ input, check }) => {
      manager.addOrder(input);
      const order = manager.getOrders().get(defaultId);
      check(order);
    });

    it('does nothing when trailing config is missing', () => {
      manager.addOrder({ ...defaultOrder, trailing: undefined });
      expect(manager.getOrders().size).toBe(0);
    });

    it('adds order if amount is undefined', () => {
      manager.addOrder({ ...defaultOrder, amount: undefined });
      expect(manager.getOrders().size).toBe(1);
    });

    it('activates order directly if trigger is undefined', () => {
      manager.addOrder({ ...defaultOrder, trailing: { percentage: 2 } });
      expect(manager.getOrders().get(defaultId)?.status).toBe('active');
    });
  });

  /* -------------------------------------------------------------------------- */
  /*                            update – dormant                                */
  /* -------------------------------------------------------------------------- */

  describe('update (dormant phase)', () => {
    beforeEach(() => {
      manager.addOrder(defaultOrder);
    });

    it.each([
      { desc: 'stays dormant below trigger', high: 49999, low: 49000, expectedStatus: 'dormant' },
      { desc: 'activates at trigger', high: 50000, low: 49500, expectedStatus: 'active' },
      { desc: 'activates above trigger', high: 51000, low: 50500, expectedStatus: 'active' },
    ])('$desc', ({ high, low, expectedStatus }) => {
      manager.update(makeBucket('BTC/USDT', high, low, 49500));
      expect(manager.getOrders().get(defaultId)?.status).toBe(expectedStatus);
    });

    it.each([
      { desc: 'sets highestPeak on activation', high: 51000, low: 50500, check: (o: any) => expect(o?.highestPeak).toBe(51000) },
      { desc: 'computes stopPrice on activation', high: 50000, low: 49500, check: (o: any) => expect(o?.stopPrice).toBe(49000) }, // 50000 * 0.98
    ])('$desc', ({ high, low, check }) => {
      manager.update(makeBucket('BTC/USDT', high, low, 49500));
      const order = manager.getOrders().get(defaultId);
      check(order);
    });

    it('emits TRAILING_STOP_ACTIVATED event on activation', () => {
      const listener = vi.fn();
      manager.on(TRAILING_STOP_ACTIVATED, listener);

      manager.update(makeBucket('BTC/USDT', 50000, 49000, 50000));

      expect(listener).toHaveBeenCalledOnce();
      const payload: TrailingStopState = listener.mock.calls[0][0];
      expect(payload.id).toBe(defaultId);
      expect(payload.status).toBe('active');
    });

    it('does not emit event if remains dormant', () => {
      const listener = vi.fn();
      manager.on(TRAILING_STOP_ACTIVATED, listener);
      manager.update(makeBucket('BTC/USDT', 49999, 49000, 49500));
      expect(listener).not.toHaveBeenCalled();
    });

    it('ignores updates for other symbols', () => {
      manager.update(makeBucket('ETH/USDT', 60000, 59000, 59500));
      expect(manager.getOrders().get(defaultId)?.status).toBe('dormant');
    });
  });

  /* -------------------------------------------------------------------------- */
  /*                            update – active                                 */
  /* -------------------------------------------------------------------------- */

  describe('update (active phase)', () => {
    beforeEach(() => {
      manager.addOrder(defaultOrder);
      // Activate order first
      // Peak 50000, Stop 49000
      // Use low 49500 to prevent immediate trigger (since dormant -> active happens same tick)
      manager.update(makeBucket('BTC/USDT', 50000, 49500, 50000));
    });

    it.each([
      // High 52000 -> Stop 50960. Low must be > 50960. Use 51000.
      { desc: 'updates peak when high > peak', high: 52000, low: 51000, expectedPeak: 52000 },
      // High 49500 -> Stop 49000. Low must be > 49000. Use 49500.
      { desc: 'keeps peak when high < peak', high: 49500, low: 49500, expectedPeak: 50000 },
    ])('$desc', ({ high, low, expectedPeak }) => {
      manager.update(makeBucket('BTC/USDT', high, low, 49500));
      expect(manager.getOrders().get(defaultId)?.highestPeak).toBe(expectedPeak);
    });

    it.each([
      // High 52000 -> Stop 50960. Use safe low 51000.
      { desc: 'updates stopPrice when peak increases', high: 52000, low: 51000, expectedStop: 50960 },
      // High 50000 -> Stop 49000. Use safe low 49500.
      { desc: 'keeps stopPrice when peak is same', high: 50000, low: 49500, expectedStop: 49000 },
    ])('$desc', ({ high, low, expectedStop }) => {
      manager.update(makeBucket('BTC/USDT', high, low, 49500));
      expect(manager.getOrders().get(defaultId)?.stopPrice).toBe(expectedStop);
    });

    it.each([
      { desc: 'triggers when low <= stopPrice', low: 48000, shouldTrigger: true },
      { desc: 'does not trigger when low > stopPrice', low: 49500, shouldTrigger: false },
    ])('$desc', ({ low, shouldTrigger }) => {
      const listener = vi.fn();
      manager.on(TRAILING_STOP_TRIGGERED, listener);

      manager.update(makeBucket('BTC/USDT', 50500, low, 50000));

      if (shouldTrigger) {
        expect(listener).toHaveBeenCalledOnce();
        expect(manager.getOrders().has(defaultId)).toBe(false);
      } else {
        expect(listener).not.toHaveBeenCalled();
        expect(manager.getOrders().has(defaultId)).toBe(true);
      }
    });
  });

  /* -------------------------------------------------------------------------- */
  /*                 update – directly active (undefined trigger)               */
  /* -------------------------------------------------------------------------- */

  describe('update (directly active via undefined trigger)', () => {
    beforeEach(() => {
      manager.addOrder({ ...defaultOrder, trailing: { percentage: 2 } });
    });

    it('updates highestPeak and stopPrice on first candle', () => {
      // Use low > 49000 so it doesn't trigger immediately
      manager.update(makeBucket('BTC/USDT', 50000, 49500, 49500));
      const order = manager.getOrders().get(defaultId);
      expect(order?.highestPeak).toBe(50000);
      expect(order?.stopPrice).toBe(49000); // 50000 * 0.98
    });

    it('triggers immediately if first candle low is low enough', () => {
      const listener = vi.fn();
      manager.on(TRAILING_STOP_TRIGGERED, listener);

      // high = 50000 -> stop = 49000. low = 48000 -> triggers!
      manager.update(makeBucket('BTC/USDT', 50000, 48000, 49500));

      expect(listener).toHaveBeenCalledOnce();
      expect(manager.getOrders().has(defaultId)).toBe(false);
    });
  });

  /* -------------------------------------------------------------------------- */
  /*                              removeOrder                                   */
  /* -------------------------------------------------------------------------- */

  describe('removeOrder', () => {
    it('removes existing order', () => {
      manager.addOrder(defaultOrder);
      expect(manager.removeOrder(defaultId)).toBe(true);
      expect(manager.getOrders().size).toBe(0);
    });

    it('returns false for non-existent order', () => {
      expect(manager.removeOrder('fake-id' as UUID)).toBe(false);
    });
  });
});
