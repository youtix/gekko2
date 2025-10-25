import { isNumberArray } from './array.utils';

export class RingBuffer<T> {
  private size: number;
  private index: number = 0;
  private buffer: T[];

  constructor(size: number) {
    this.buffer = [];
    this.size = size;
  }

  max() {
    return isNumberArray(this.buffer) ? Math.max(...this.buffer) : NaN;
  }

  min() {
    return isNumberArray(this.buffer) ? Math.min(...this.buffer) : NaN;
  }

  first() {
    return this.toArray()[0];
  }

  last() {
    const arr = this.toArray();
    return arr[arr.length - 1];
  }

  push(...items: T[]) {
    items.forEach((item: T) => {
      this.buffer[this.index] = item;
      this.index = (this.index + 1) % this.size;
    });
  }

  isFull() {
    return this.buffer.length === this.size;
  }

  find(predicate: (item: T) => boolean): T | undefined {
    const full = this.isFull();
    const len = full ? this.size : this.index;
    const start = full ? this.index : 0;
    for (let i = 0; i < len; i++) {
      const cursor = full ? (start + i) % this.size : i;
      const item = this.buffer[cursor];
      if (predicate(item)) return item;
    }
  }

  forEach(cb: (value: T, index: number, array: T[]) => void): void {
    const full = this.isFull();
    const len = full ? this.size : this.index;
    const start = full ? this.index : 0;
    const arr = this.toArray();
    for (let i = 0; i < len; i++) {
      const cursor = full ? (start + i) % this.size : i;
      cb(this.buffer[cursor], i, arr);
    }
  }

  toArray() {
    if (!this.isFull()) return this.buffer.slice(0, this.index);
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }
}
