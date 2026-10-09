import { describe, expect, it, vi } from 'vitest';
import { RingBuffer } from './ringBuffer';

const filled = <T>(size: number, values: T[]) => {
  const rb = new RingBuffer<T>(size);
  values.forEach(value => rb.push(value));
  return rb;
};

describe('RingBuffer', () => {
  it('should store values in insertion order until full', () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3].forEach(v => rb.push(v));

    expect(rb.isFull()).toBe(false);
    expect(rb.toArray()).toEqual([1, 2, 3]);
  });

  it('should report full and keeps chronological order after exactly `size` pushes', () => {
    const rb = new RingBuffer<number>(3);
    [10, 20, 30].forEach(v => rb.push(v));

    expect(rb.isFull()).toBe(true);
    expect(rb.toArray()).toEqual([10, 20, 30]);
  });

  it('should overwrite oldest items once capacity is exceeded', () => {
    const rb = new RingBuffer<number>(4);
    [1, 2, 3, 4, 5, 6].forEach(v => rb.push(v));

    expect(rb.toArray()).toEqual([3, 4, 5, 6]);
    expect(rb.isFull()).toBe(true);
  });

  it('should work correctly with a buffer size of 1', () => {
    const rb = new RingBuffer<string>(1);
    rb.push('A');

    expect(rb.toArray()).toEqual(['A']);

    rb.push('B');

    expect(rb.toArray()).toEqual(['B']);
    expect(rb.isFull()).toBe(true);
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

  describe('push', () => {
    it('should keep the last size items of a push of several, oldest first', () => {
      const rb = new RingBuffer<number>(4);
      rb.push(1, 2, 3, 4, 5, 6);

      expect(rb.toArray()).toEqual([3, 4, 5, 6]);
    });
  });

  describe('length', () => {
    it.each`
      size | values             | expected
      ${3} | ${[]}              | ${0}
      ${3} | ${[1, 2]}          | ${2}
      ${3} | ${[1, 2, 3, 4, 5]} | ${3}
    `('should hold $expected items after pushing $values into $size slots', ({ size, values, expected }) => {
      expect(filled(size, values).length).toBe(expected);
    });
  });

  describe('first and at', () => {
    it.each`
      size | values                   | expected
      ${3} | ${[]}                    | ${undefined}
      ${3} | ${[1, 2]}                | ${1}
      ${3} | ${[1, 2, 3]}             | ${1}
      ${3} | ${[1, 2, 3, 4]}          | ${2}
      ${3} | ${[1, 2, 3, 4, 5, 6, 7]} | ${5}
      ${1} | ${[1, 2]}                | ${2}
    `('should return $expected from first() after pushing $values into $size slots', ({ size, values, expected }) => {
      expect(filled<number>(size, values).first()).toBe(expected);
    });

    it.each`
      size | values                | index | expected
      ${4} | ${[]}                 | ${0}  | ${undefined}
      ${4} | ${[1, 2]}             | ${0}  | ${1}
      ${4} | ${[1, 2]}             | ${1}  | ${2}
      ${4} | ${[1, 2]}             | ${2}  | ${undefined}
      ${4} | ${[1, 2]}             | ${-1} | ${undefined}
      ${4} | ${[1, 2, 3, 4, 5, 6]} | ${0}  | ${3}
      ${4} | ${[1, 2, 3, 4, 5, 6]} | ${1}  | ${4}
      ${4} | ${[1, 2, 3, 4, 5, 6]} | ${2}  | ${5}
      ${4} | ${[1, 2, 3, 4, 5, 6]} | ${3}  | ${6}
      ${4} | ${[1, 2, 3, 4, 5, 6]} | ${4}  | ${undefined}
      ${1} | ${[1, 2]}             | ${0}  | ${2}
    `('should return $expected at index $index after pushing $values into $size slots', ({ size, values, index, expected }) => {
      expect(filled(size, values).at(index)).toBe(expected);
    });
  });

  describe('max and min', () => {
    // As Math.max and Math.min of the items: NaN wins, and 0 is above -0 whatever their order
    it.each`
      read     | values         | expected
      ${'max'} | ${[]}          | ${-Infinity}
      ${'min'} | ${[]}          | ${Infinity}
      ${'max'} | ${[-0, 0, -0]} | ${0}
      ${'min'} | ${[0, -0, 0]}  | ${-0}
      ${'max'} | ${[1, NaN, 3]} | ${NaN}
      ${'min'} | ${[1, NaN, 3]} | ${NaN}
    `('should return $expected from $read() of $values', ({ read, values, expected }) => {
      const rb = filled<number>(3, values);

      expect(read === 'max' ? rb.max() : rb.min()).toBe(expected);
    });

    // Math.max would read '2' as 2
    it.each`
      read     | values
      ${'max'} | ${['1', '2']}
      ${'min'} | ${['1', '2']}
      ${'max'} | ${[1, '2']}
      ${'min'} | ${[1, '2']}
    `('should return NaN from $read() of $values, which holds a non-number', ({ read, values }) => {
      const rb = filled<unknown>(3, values);

      expect(read === 'max' ? rb.max() : rb.min()).toBeNaN();
    });
  });

  describe('sum', () => {
    // 1e16 + 1 rounds back to 1e16, so these sums tell the orders apart: the physical order of the first row gives 1, and so does the
    // newest-first order of the second. A sum from 0 rather than from the oldest item turns the -0 of the third into 0.
    it.each`
      size | values                 | expected
      ${3} | ${[5, 1e16, 1, -1e16]} | ${0}
      ${3} | ${[7, 1, 1e16, -1e16]} | ${0}
      ${2} | ${[-0, -0]}            | ${-0}
      ${3} | ${[]}                  | ${0}
      ${3} | ${[1, 2]}              | ${3}
      ${1} | ${[4, 6]}              | ${6}
      ${3} | ${[1, NaN, 2]}         | ${NaN}
    `('should return $expected as the sum after pushing $values into $size slots', ({ size, values, expected }) => {
      expect(filled<number>(size, values).sum()).toBe(expected);
    });
  });

  describe('reduce', () => {
    it.each`
      size | values                | expected
      ${3} | ${[]}                 | ${[]}
      ${3} | ${[1, 2]}             | ${[1, 2]}
      ${3} | ${[1, 2, 3, 4, 5]}    | ${[3, 4, 5]}
      ${3} | ${[1, 2, 3, 4, 5, 6]} | ${[4, 5, 6]}
    `('should fold $expected oldest first after pushing $values into $size slots', ({ size, values, expected }) => {
      const rb = filled<number>(size, values);

      expect(rb.reduce<number[]>((items, item) => [...items, item], [])).toEqual(expected);
    });

    it('should hand the argument to every call of the callback', () => {
      const rb = filled(3, [1, 2, 3, 4]);

      expect(rb.reduce((items: number[], item: number, factor: number) => [...items, item * factor], [], 10)).toEqual([20, 30, 40]);
    });
  });

  describe('reading in place', () => {
    // first used to copy the whole buffer through toArray on every call
    it.each`
      read        | call
      ${'first'}  | ${(rb: RingBuffer<number>) => rb.first()}
      ${'at'}     | ${(rb: RingBuffer<number>) => rb.at(1)}
      ${'max'}    | ${(rb: RingBuffer<number>) => rb.max()}
      ${'min'}    | ${(rb: RingBuffer<number>) => rb.min()}
      ${'sum'}    | ${(rb: RingBuffer<number>) => rb.sum()}
      ${'reduce'} | ${(rb: RingBuffer<number>) => rb.reduce((sum, item) => sum + item, 0)}
    `('should read $read without copying the buffer', ({ call }) => {
      const rb = filled(3, [1, 2, 3, 4]);
      const toArray = vi.spyOn(rb, 'toArray');

      call(rb);

      expect(toArray).not.toHaveBeenCalled();
    });
  });
});
