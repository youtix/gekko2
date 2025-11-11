import { describe, expect, it } from 'vitest';
import { Fifo } from './fifo';

describe('Fifo', () => {
  describe('construction & push', () => {
    it.each`
      initial      | pushes           | expected               | finalSize | empty
      ${undefined} | ${[1, 2, 3]}     | ${[1, 2, 3]}           | ${3}      | ${false}
      ${[]}        | ${[]}            | ${[]}                  | ${0}      | ${true}
      ${[42]}      | ${[7, 8]}        | ${[42, 7, 8]}          | ${3}      | ${false}
      ${[5, 6]}    | ${[7, 8, 9, 10]} | ${[5, 6, 7, 8, 9, 10]} | ${6}      | ${false}
    `(
      'retains FIFO order when initial=$initial and pushes=$pushes',
      ({
        initial,
        pushes,
        expected,
        finalSize,
        empty,
      }: {
        initial: number[] | undefined;
        pushes: number[];
        expected: number[];
        finalSize: number;
        empty: boolean;
      }) => {
        const queue = new Fifo<number>(initial);

        pushes.forEach(value => {
          const reportedSize = queue.push(value);
          expect(reportedSize).toBe(queue.size());
        });

        expect(queue.toArray()).toEqual(expected);
        expect(queue.size()).toBe(finalSize);
        expect(queue.isEmpty()).toBe(empty);
        expect(queue.peek()).toBe(expected[0]);
      },
    );
  });

  describe('shift', () => {
    it.each`
      initial          | shiftCount | expectedShifted  | finalPeek    | finalSize
      ${[1, 2, 3]}     | ${1}       | ${[1]}           | ${2}         | ${2}
      ${[4, 5, 6]}     | ${2}       | ${[4, 5]}        | ${6}         | ${1}
      ${[9]}           | ${1}       | ${[9]}           | ${undefined} | ${0}
      ${[]}            | ${1}       | ${[undefined]}   | ${undefined} | ${0}
      ${[7, 8, 9, 10]} | ${4}       | ${[7, 8, 9, 10]} | ${undefined} | ${0}
    `(
      'shifting $shiftCount time(s) from $initial yields $expectedShifted',
      ({
        initial,
        shiftCount,
        expectedShifted,
        finalPeek,
        finalSize,
      }: {
        initial: number[];
        shiftCount: number;
        expectedShifted: Array<number | undefined>;
        finalPeek: number | undefined;
        finalSize: number;
      }) => {
        const queue = new Fifo<number>(initial);
        const shifted: Array<number | undefined> = [];

        for (let i = 0; i < shiftCount; i++) shifted.push(queue.shift());

        expect(shifted).toEqual(expectedShifted);
        expect(queue.peek()).toBe(finalPeek);
        expect(queue.size()).toBe(finalSize);
        expect(queue.toArray()).toEqual(initial.slice(shiftCount));
      },
    );
  });

  it('supports reuse after being completely drained', () => {
    const queue = new Fifo<number>([1, 2]);
    queue.shift();
    queue.shift();

    expect(queue.isEmpty()).toBe(true);
    expect(queue.peek()).toBeUndefined();

    queue.push(99);
    expect(queue.toArray()).toEqual([99]);
    expect(queue.peek()).toBe(99);
    expect(queue.size()).toBe(1);
  });

  it('clear removes every element and resets bookkeeping', () => {
    const queue = new Fifo<number>([3, 4, 5]);
    queue.clear();

    expect(queue.size()).toBe(0);
    expect(queue.isEmpty()).toBe(true);
    expect(queue.peek()).toBeUndefined();
    expect(queue.toArray()).toEqual([]);

    queue.push(11);
    expect(queue.toArray()).toEqual([11]);
  });

  it('peek reads but does not remove the head element', () => {
    const queue = new Fifo<number>();
    queue.push(1);
    queue.push(2);

    expect(queue.peek()).toBe(1);
    expect(queue.size()).toBe(2);
    expect(queue.toArray()).toEqual([1, 2]);
  });

  it('toArray provides a defensive copy of the queue snapshot', () => {
    type Payload = { id: number };
    const queue = new Fifo<Payload>();
    queue.push({ id: 1 });
    queue.push({ id: 2 });

    const snapshot = queue.toArray();
    snapshot.pop();
    snapshot[0] = { id: 99 };

    const secondSnapshot = queue.toArray();
    expect(snapshot).not.toBe(secondSnapshot);
    expect(secondSnapshot).toEqual([{ id: 1 }, { id: 2 }]);
  });
});
