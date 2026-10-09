import { describe, expect, it, vi } from 'vitest';
import { copyPayload } from './event.utils';

const createPortfolio = () =>
  new Map([
    ['BTC', { free: 1, used: 0, total: 1 }],
    ['USDT', { free: 100, used: 0, total: 100 }],
  ]);

const createOrderEvent = () => ({
  order: { id: 'order', side: 'BUY', amount: 1, price: 100, fee: NaN, filled: undefined, reason: null },
  exchange: { price: 100, portfolio: createPortfolio() },
});

const createSparseArray = () => {
  const array = [1, 2, 3];
  delete array[1];
  return array;
};

/** Two references to one object, which structuredClone keeps as one */
const createSharingPayload = () => {
  const shared = { free: 1 };
  return { first: shared, second: shared };
};

/** An object that refers to itself, which structuredClone keeps as a cycle */
const createCyclicPayload = () => {
  const payload: { name: string; self?: unknown } = { name: 'root' };
  payload.self = payload;
  return payload;
};

/** A payload as a listener gets it: what structuredClone made of it when it was queued */
const queue = <T>(payload: T) => structuredClone(payload);

describe('copyPayload', () => {
  it.each`
    kind                                 | payload
    ${'a primitive'}                     | ${42}
    ${'null'}                            | ${null}
    ${'a portfolio'}                     | ${createPortfolio()}
    ${'a timeframe bucket'}              | ${new Map([['BTC/USDT', { start: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 }]])}
    ${'an order event'}                  | ${createOrderEvent()}
    ${'an array of payloads'}            | ${[createPortfolio(), createOrderEvent()]}
    ${'an array with a hole'}            | ${createSparseArray()}
    ${'an array with a property'}        | ${Object.assign([1, 2], { note: 'kept' })}
    ${'a Map keyed by objects'}          | ${new Map([[{ pair: 'BTC/USDT' }, 1]])}
    ${'a Date in a Map'}                 | ${new Map([['at', new Date(0)]])}
    ${'a Set'}                           | ${new Set([1, 2])}
    ${'an Error'}                        | ${new Error('boom')}
    ${'a typed array'}                   | ${new Uint8Array([1, 2])}
    ${'an object with an own __proto__'} | ${JSON.parse('{"__proto__": {"polluted": true}, "free": 1}')}
  `('should copy $kind as structuredClone does', ({ payload }) => {
    const queued = queue(payload);
    expect(copyPayload(queued)).toStrictEqual(structuredClone(queued));
  });

  it.each`
    written                         | write
    ${'a balance of the portfolio'} | ${(copy: ReturnType<typeof createOrderEvent>) => (copy.exchange.portfolio.get('BTC')!.free = 0)}
    ${'an entry of the portfolio'}  | ${(copy: ReturnType<typeof createOrderEvent>) => copy.exchange.portfolio.delete('BTC')}
    ${'a field of the order'}       | ${(copy: ReturnType<typeof createOrderEvent>) => (copy.order.amount = 99)}
  `('should leave the payload as it was when the copy has $written changed', ({ write }) => {
    const queued = queue(createOrderEvent());
    write(copyPayload(queued));

    expect(queued).toStrictEqual(queue(createOrderEvent()));
  });

  // The copy by hand is the point: one that threw would still be right, by structuredClone, but no faster
  it.each`
    kind                             | create                                   | copier                  | calls
    ${'a portfolio'}                 | ${createPortfolio}                       | ${'by hand'}            | ${0}
    ${'an order event'}              | ${createOrderEvent}                      | ${'by hand'}            | ${0}
    ${'an array with a hole'}        | ${createSparseArray}                     | ${'by hand'}            | ${0}
    ${'two references to an object'} | ${createSharingPayload}                  | ${'by hand'}            | ${0}
    ${'a cycle'}                     | ${createCyclicPayload}                   | ${'by hand'}            | ${0}
    ${'a Set'}                       | ${() => new Set([1])}                    | ${'by structuredClone'} | ${1}
    ${'a Date in an order event'}    | ${() => ({ order: { at: new Date() } })} | ${'by structuredClone'} | ${1}
  `('should copy $kind $copier', ({ create, calls }) => {
    const queued = queue(create());
    const clone = vi.spyOn(globalThis, 'structuredClone');

    copyPayload(queued);

    expect(clone).toHaveBeenCalledTimes(calls);
  });

  it('should leave the key of a Map as it was when the copy has its key changed', () => {
    const queued = queue(new Map([[{ pair: 'BTC/USDT' }, 1]]));
    const [key] = copyPayload(queued).keys();
    key.pair = 'ETH/USDT';

    expect(Array.from(queued.keys())).toEqual([{ pair: 'BTC/USDT' }]);
  });

  it('should keep two references to one object as one', () => {
    const copy = copyPayload(queue(createSharingPayload()));
    expect(copy.first).toBe(copy.second);
  });

  it('should keep a cycle', () => {
    const copy = copyPayload(queue(createCyclicPayload()));
    expect(copy.self).toBe(copy);
  });

  it('should keep an own __proto__ as a property, not as the prototype', () => {
    const copy = copyPayload(queue(JSON.parse('{"__proto__": {"polluted": true}}')));
    expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
  });
});
