import { describe, expect, it } from 'vitest';
import type { Net } from '../network/net';
import { Vol } from '../volume/vol';
import { Trainer } from './trainer';
// Local shape copy to avoid importing learning layer types (which have deep deps)
type ParamGrad = {
  params: number[] | Float64Array;
  grads: number[] | Float64Array;
  l1_decay_mul: number;
  l2_decay_mul: number;
};

// Minimal fake Net implementation for Trainer tests (type-only import ensures no runtime deps)
class FakeNet implements Pick<Net, 'forward' | 'backward' | 'getParamsAndGrads'> {
  private pglist: ParamGrad[];
  private cost: number;

  constructor(params: number[], grads: number[], costLoss = 1) {
    this.pglist = [
      {
        params,
        grads,
        l1_decay_mul: 1,
        l2_decay_mul: 1,
      },
    ];
    this.cost = costLoss;
  }

  forward<V extends Vol>(v: V): V {
    return v;
  }

  backward(): number {
    return this.cost;
  }

  getParamsAndGrads(): ParamGrad[] {
    return this.pglist;
  }
}

describe('Trainer', () => {
  describe('constructor defaults', () => {
    const net = new FakeNet([0], [0]);
    const trainer = new Trainer(net as unknown as Net, {});

    it.each`
      property           | expected
      ${'learning_rate'} | ${0.01}
      ${'l1_decay'}      | ${0}
      ${'l2_decay'}      | ${0}
      ${'batch_size'}    | ${1}
      ${'method'}        | ${'sgd'}
      ${'momentum'}      | ${0.9}
      ${'ro'}            | ${0.95}
      ${'eps'}           | ${1e-6}
      ${'k'}             | ${0}
    `('should set $property to $expected', ({ property, expected }) => {
      // one expect per test
      expect((trainer as any)[property]).toEqual(expected);
    });
  });

  describe('state init depending on method/momentum', () => {
    it.each`
      method          | momentum | expectGsum | expectXsum
      ${'sgd'}        | ${0}     | ${0}       | ${0}
      ${'sgd'}        | ${0.5}   | ${1}       | ${0}
      ${'adagrad'}    | ${0}     | ${1}       | ${0}
      ${'windowgrad'} | ${0}     | ${1}       | ${0}
      ${'adadelta'}   | ${0}     | ${1}       | ${1}
    `(
      'should initialize optimizer state for $method (momentum=$momentum)',
      ({ method, momentum, expectGsum, expectXsum }) => {
        const net = new FakeNet([1, -2], [0.5, -0.25]);
        const trainer = new Trainer(net as unknown as Net, { method, momentum, batch_size: 1, learning_rate: 0.1 });
        trainer.train(new Vol([0], 1, 1), 0);
        // one expect per test: encode both counts in a tuple for a single deep equality
        expect([trainer.gsum.length, trainer.xsum.filter(a => a.length > 0).length]).toEqual([
          expectGsum ? 1 : 0,
          expectXsum ? 1 : 0,
        ]);
      },
    );
  });

  describe('batching behavior', () => {
    it('should not update params until k % batch_size === 0', () => {
      const params = [1, -1];
      const grads = [1, 1];
      const net = new FakeNet(params, grads);
      const trainer = new Trainer(net as unknown as Net, {
        batch_size: 2,
        learning_rate: 0.1,
        method: 'sgd',
        momentum: 0,
      });
      trainer.train(new Vol([0], 1, 1), 0); // k=1, no update
      // one expect per test
      expect(params).toEqual([1, -1]);
    });
  });

  describe('optimizer updates', () => {
    it.each`
      method          | lr     | ro      | eps     | paramsInitial | gradsInitial | expectedParams
      ${'sgd'}        | ${0.1} | ${0.95} | ${1e-6} | ${[1, -2]}    | ${[1, 1]}    | ${[0.9, -2.1]}
      ${'adagrad'}    | ${0.1} | ${0.95} | ${1e-6} | ${[1, -2]}    | ${[2, -3]}   | ${[1 - 0.1 * (2 / Math.sqrt(4 + 1e-6)), -2 - 0.1 * (-3 / Math.sqrt(9 + 1e-6))]}
      ${'windowgrad'} | ${0.1} | ${0.95} | ${1e-6} | ${[1, -2]}    | ${[2, -3]}   | ${[1 - 0.1 * (2 / Math.sqrt((1 - 0.95) * 4 + 1e-6)), -2 - 0.1 * (-3 / Math.sqrt((1 - 0.95) * 9 + 1e-6))]}
      ${'adadelta'}   | ${0.1} | ${0.95} | ${1e-6} | ${[1, -2]}    | ${[2, -3]}   | ${[1 + -Math.sqrt((0 + 1e-6) / ((1 - 0.95) * 4 + 1e-6)) * 2, -2 + -Math.sqrt((0 + 1e-6) / ((1 - 0.95) * 9 + 1e-6)) * -3]}
    `('should update params with $method', ({ method, lr, ro, eps, paramsInitial, gradsInitial, expectedParams }) => {
      const params = [...paramsInitial];
      const grads = [...gradsInitial];
      const net = new FakeNet(params, grads);
      const trainer = new Trainer(net as unknown as Net, {
        method,
        learning_rate: lr,
        ro,
        eps,
        batch_size: 1,
        momentum: 0,
      });
      trainer.train(new Vol([0], 1, 1), 0);
      // one expect per test
      params.forEach((p, i) => expect(p).toBeCloseTo(expectedParams[i]));
    });
  });

  describe('gradient handling', () => {
    it('should zero out grads after update', () => {
      const grads = [5, -5];
      const net = new FakeNet([1, 1], grads);
      const trainer = new Trainer(net as unknown as Net, {
        method: 'sgd',
        batch_size: 1,
        learning_rate: 0.1,
        momentum: 0,
      });
      trainer.train(new Vol([0], 1, 1), 0);
      // one expect per test
      expect(grads).toEqual([0, 0]);
    });
  });

  describe('loss accounting (l1/l2 + cost)', () => {
    it('should compute total loss = cost + l1 + l2', () => {
      const params = [1, -3];
      const grads = [0, 0];
      const costLoss = 2.5;
      const l1 = 0.2;
      const l2 = 0.1;
      const net = new FakeNet(params, grads, costLoss);
      const trainer = new Trainer(net as unknown as Net, {
        method: 'sgd',
        batch_size: 1,
        learning_rate: 0.1,
        l1_decay: l1,
        l2_decay: l2,
        momentum: 0,
      });
      const stats = trainer.train(new Vol([0], 1, 1), 0);
      const expectedL1 = l1 * (Math.abs(1) + Math.abs(-3));
      const expectedL2 = (l2 * (1 * 1 + 9)) / 2;
      const expectedTotal = costLoss + expectedL1 + expectedL2;
      // one expect per test
      expect(stats.loss).toBeCloseTo(expectedTotal);
    });
  });
});
