/** Thrown by copyPlainData on anything but plain data, for copyPayload to fall back on structuredClone */
const NOT_PLAIN_DATA = new Error('Not plain data');

/**
 * Copies plain data: primitives, objects and arrays of Object's and Array's prototypes, and Maps, with their holes, shared references
 * and cycles. Throws NOT_PLAIN_DATA on anything else, an own __proto__ property included, which an assignment would take for the
 * prototype.
 */
const copyPlainData = (value: unknown, copies: Map<object, unknown>): unknown => {
  if (typeof value !== 'object' || value === null) return value;
  const known = copies.get(value);
  if (known) return known;
  if (value instanceof Map) {
    const map = new Map();
    copies.set(value, map);
    for (const [key, item] of value) map.set(copyPlainData(key, copies), copyPlainData(item, copies));
    return map;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== Array.prototype) throw NOT_PLAIN_DATA;
  const copy = (Array.isArray(value) ? new Array(value.length) : {}) as Record<string, unknown>;
  copies.set(value, copy);
  for (const key of Object.keys(value)) {
    if (key === '__proto__') throw NOT_PLAIN_DATA;
    copy[key] = copyPlainData((value as Record<string, unknown>)[key], copies);
  }
  return copy;
};

/**
 * A copy of what structuredClone made of a payload, equal to the one structuredClone would make of it again. Plain data, what the
 * deferred events hold (Maps of balances or candles, orders, advices), is copied by hand: two to three times faster than structuredClone
 * on the payloads of a backtest, which pays a copy for every listener but the last of each portfolio change and order end. Anything else
 * is copied by structuredClone itself (a Date, a Set, an Error, a typed array), and so is a payload nested deeper than this copy goes.
 */
export const copyPayload = <T>(payload: T): T => {
  try {
    return copyPlainData(payload, new Map()) as T;
  } catch {
    return structuredClone(payload);
  }
};
