import { describe, expect, it } from 'vitest';
import { RingBuffer } from './ringBuffer';

describe('RingBuffer', () => {
  it('should store values in insertion order until full', () => {
    const rb = new RingBuffer<number>(5);
    expect(rb.length).toBe(0);
    [1, 2, 3].forEach(v => rb.push(v));

    expect(rb.isFull()).toBe(false);
    expect(rb.length).toBe(3);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it('should report full and keeps chronological order after exactly `size` pushes', () => {
    const rb = new RingBuffer<number>(3);
    [10, 20, 30].forEach(v => rb.push(v));

    expect(rb.isFull()).toBe(true);
    expect(rb.length).toBe(3);
    expect(rb.toArray()).toEqual([10, 20, 30]);
  });

  it('should overwrite oldest items once capacity is exceeded', () => {
    const rb = new RingBuffer<number>(4);
    [1, 2, 3, 4, 5, 6].forEach(v => rb.push(v));

    expect(rb.toArray()).toEqual([3, 4, 5, 6]);
    expect(rb.isFull()).toBe(true);
    expect(rb.length).toBe(4);
  });

  it('should work correctly with a buffer size of 1', () => {
    const rb = new RingBuffer<string>(1);
    rb.push('A');

    expect(rb.toArray()).toEqual(['A']);
    expect(rb.length).toBe(1);

    rb.push('B');

    expect(rb.toArray()).toEqual(['B']);
    expect(rb.isFull()).toBe(true);
    expect(rb.length).toBe(1);
  });

  it('should return a defensive copy from toArray()', () => {
    const rb = new RingBuffer<number>(2);
    rb.push(7);
    const snapshot = rb.toArray();
    snapshot[0] = 999;

    expect(rb.toArray()).toEqual([7]);
  });

  it('should handle multiple wrap-around cycles correctly', () => {
    const rb = new RingBuffer<number>(3);
    for (let i = 1; i <= 10; i++) rb.push(i);

    expect(rb.toArray()).toEqual([8, 9, 10]);
  });
  describe('min & max', () => {
    it('should return correct values when buffer not full', () => {
      const rb = new RingBuffer<number>(5);
      [4, 1, 7].forEach(v => rb.push(v));

      expect(rb.max()).toBe(7);
      expect(rb.min()).toBe(1);
    });

    it('should return correct values after wrap-around', () => {
      const rb = new RingBuffer<number>(3);
      [-15, 11, 9, 2, 8].forEach(v => rb.push(v)); // final contents: [9, 2, 8]

      expect(rb.max()).toBe(9);
      expect(rb.min()).toBe(2);
    });

    it('should work with buffer size 1', () => {
      const rb = new RingBuffer<number>(1);
      rb.push(3);
      expect(rb.max()).toBe(3);
      expect(rb.min()).toBe(3);

      rb.push(-5);
      expect(rb.max()).toBe(-5);
      expect(rb.min()).toBe(-5);
    });

    it('should return NaN on non-number RingBuffer', () => {
      const rb = new RingBuffer<string>(2);
      rb.push('a');
      rb.push('b');

      expect(rb.max()).toBeNaN();
      expect(rb.min()).toBeNaN();
    });
  });
});
