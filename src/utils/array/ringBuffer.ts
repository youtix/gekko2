import { isNumberArray } from './array.utils';

/**
 * Fixed-size circular buffer with O(1) append and stable iteration order.
 * - Maintains the last `size` pushed items, overwriting the oldest when full.
 * - `toArray()` returns items in chronological order (oldest -> newest).
 * - Numeric helpers (`max`, `min`) operate only on number buffers; otherwise return `NaN`.
 */
export class RingBuffer<T> {
  /**
   * Capacity of the buffer (maximum number of elements stored).
   */
  private size: number;

  /**
   * Next write position (wraps to 0 when reaching `size`).
   */
  private index: number = 0;

  /**
   * Internal storage. When not full, length equals count of inserted items.
   */
  private buffer: T[];

  /**
   * Create a ring buffer with a fixed `size` capacity.
   * @param size Maximum number of items to retain.
   */
  constructor(size: number) {
    this.buffer = [];
    this.size = size;
  }

  /**
   * Current number of elements stored in the buffer.
   * - Grows up to `size`, then stays at `size` when full.
   */
  get length() {
    return this.isFull() ? this.size : this.index;
  }

  /**
   * Maximum value in the buffer for numeric buffers.
   * @returns The maximum number or `NaN` if T is not number or buffer is empty.
   */
  max() {
    return isNumberArray(this.buffer) ? Math.max(...this.buffer) : NaN;
  }

  /**
   * Minimum value in the buffer for numeric buffers.
   * @returns The minimum number or `NaN` if T is not number or buffer is empty.
   */
  min() {
    return isNumberArray(this.buffer) ? Math.min(...this.buffer) : NaN;
  }

  /**
   * Oldest element currently stored.
   * @returns The first item in chronological order, or `undefined` if empty.
   */
  first() {
    return this.toArray()[0];
  }

  /**
   * Newest element currently stored.
   * @returns The last item in chronological order, or `undefined` if empty.
   */
  last() {
    const arr = this.toArray();
    return arr[arr.length - 1];
  }

  /**
   * Append one or more items, overwriting oldest items when capacity is exceeded.
   * Amortized O(k) for k items, O(1) per item.
   * @param items Values to append to the buffer.
   */
  push(...items: T[]) {
    items.forEach((item: T) => {
      this.buffer[this.index] = item;
      this.index = (this.index + 1) % this.size;
    });
  }

  /**
   * Whether the buffer has reached its capacity.
   */
  isFull() {
    return this.buffer.length === this.size;
  }

  /**
   * Snapshot of items in chronological order (oldest -> newest).
   * - If not full, returns elements from index 0 up to the next write position.
   * - If full, returns elements starting from the oldest (current `index`) wrapping to the newest.
   */
  toArray() {
    if (!this.isFull()) return this.buffer.slice(0, this.index);
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }
}
