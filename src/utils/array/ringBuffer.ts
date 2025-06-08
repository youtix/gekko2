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

  toArray() {
    if (!this.isFull()) return this.buffer.slice(0, this.index);
    return [...this.buffer.slice(this.index), ...this.buffer.slice(0, this.index)];
  }
}
