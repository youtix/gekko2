import { isNumber } from 'lodash-es';

/** A sum that starts from its first item, as lodash's does: one that starts from 0 turns a sum of -0 into 0 */
const addFromFirst = (sum: number | undefined, item: number) => (sum === undefined ? item : sum + item);

/**
 * The last `size` items pushed, read oldest first. Every read works on the items in place: first, last and at are index arithmetic,
 * and max, min, sum and reduce walk the items once without copying them. first and last used to take the whole window through
 * toArray, three arrays per call, on every candle of ROC, WilliamsR and TRIX; CCI and BollingerBands copied it to sum it.
 */
export class RingBuffer<T> {
  private size: number;
  private index: number = 0;
  private buffer: T[];

  constructor(size: number) {
    this.buffer = [];
    this.size = size;
  }

  /** The items held: the pushes so far, at most size */
  get length() {
    return this.buffer.length;
  }

  /** The largest item, as Math.max of them all would give it: NaN if one is not a number, -Infinity while empty */
  max() {
    const buffer = this.buffer;
    let max = -Infinity;
    for (let i = 0; i < buffer.length; i++) {
      const item = buffer[i];
      if (!isNumber(item)) return NaN;
      max = Math.max(max, item);
    }
    return max;
  }

  /** The smallest item, as Math.min of them all would give it: NaN if one is not a number, Infinity while empty */
  min() {
    const buffer = this.buffer;
    let min = Infinity;
    for (let i = 0; i < buffer.length; i++) {
      const item = buffer[i];
      if (!isNumber(item)) return NaN;
      min = Math.min(min, item);
    }
    return min;
  }

  /** The items added oldest first, as lodash's sum of toArray() adds them (see addFromFirst). 0 while empty */
  sum(this: RingBuffer<number>) {
    return this.reduce<number | undefined>(addFromFirst, undefined) ?? 0;
  }

  /**
   * Folds the items oldest first, as toArray().reduce(callback, initial) would, without copying them. `argument` goes to every call, so
   * that a callback needing a value of its caller can be a function made once: a closure over the value is made on every call
   */
  reduce<U>(callback: (accumulator: U, item: T) => U, initial: U): U;
  reduce<U, A>(callback: (accumulator: U, item: T, argument: A) => U, initial: U, argument: A): U;
  reduce<U, A>(callback: (accumulator: U, item: T, argument?: A) => U, initial: U, argument?: A): U {
    const buffer = this.buffer;
    // Until the buffer is full the oldest item is at 0; then it is the next one push overwrites
    const start = this.isFull() ? this.index : 0;
    let accumulator = initial;
    for (let i = start; i < buffer.length; i++) accumulator = callback(accumulator, buffer[i], argument);
    for (let i = 0; i < start; i++) accumulator = callback(accumulator, buffer[i], argument);
    return accumulator;
  }

  /** The item `index` places after the oldest, read in place: undefined outside the items held */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.buffer.length) return undefined;
    const cursor = (this.isFull() ? this.index : 0) + index;
    return this.buffer[cursor < this.size ? cursor : cursor - this.size];
  }

  /** The oldest item, undefined while empty */
  first() {
    return this.at(0);
  }

  /** The newest item, undefined while empty */
  last() {
    return this.at(this.buffer.length - 1);
  }

  push(...items: T[]) {
    // A plain loop: forEach made a closure on every push
    for (let i = 0; i < items.length; i++) {
      this.buffer[this.index] = items[i];
      this.index = (this.index + 1) % this.size;
    }
  }

  isFull() {
    return this.buffer.length === this.size;
  }

  toArray() {
    if (!this.isFull()) return this.buffer.slice(0, this.index);
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }
}
