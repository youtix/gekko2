import { bench, describe } from 'vitest';
import { SequentialEventEmitter } from './sequentialEventEmitter';

describe('SequentialEventEmitter Performance', () => {
  describe('on', () => {
    bench('on - register single listener', () => {
      const emitter = new SequentialEventEmitter('bench');
      emitter.on('test', () => {});
    });

    bench('on - register 10 listeners', () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 10; i++) {
        emitter.on('test', () => {});
      }
    });

    bench('on - register 100 listeners', () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 100; i++) {
        emitter.on('test', () => {});
      }
    });
  });

  describe('off', () => {
    bench('off - unregister listener', () => {
      const emitter = new SequentialEventEmitter('bench');
      const listener = () => {};
      emitter.on('test', listener);
      emitter.off('test', listener);
    });
  });

  describe('emit', () => {
    bench('emit - single sync listener', async () => {
      const emitter = new SequentialEventEmitter('bench');
      emitter.on('test', () => {});
      await emitter.emit('test', { data: 42 });
    });

    bench('emit - 10 sync listeners', async () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 10; i++) {
        emitter.on('test', () => {});
      }
      await emitter.emit('test', { data: 42 });
    });

    bench('emit - single async listener', async () => {
      const emitter = new SequentialEventEmitter('bench');
      emitter.on('test', async () => {});
      await emitter.emit('test', { data: 42 });
    });

    bench('emit - 10 async listeners', async () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 10; i++) {
        emitter.on('test', async () => {});
      }
      await emitter.emit('test', { data: 42 });
    });

    bench('emit - no listeners (noop)', async () => {
      const emitter = new SequentialEventEmitter('bench');
      await emitter.emit('test', { data: 42 });
    });
  });

  describe('addDeferredEmit', () => {
    bench('addDeferredEmit - single event', () => {
      const emitter = new SequentialEventEmitter('bench');
      emitter.addDeferredEmit('test', { data: 42 });
    });

    bench('addDeferredEmit - 10 events same name', () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 10; i++) {
        emitter.addDeferredEmit('test', { data: i });
      }
    });

    bench('addDeferredEmit - 100 events same name', () => {
      const emitter = new SequentialEventEmitter('bench');
      for (let i = 0; i < 100; i++) {
        emitter.addDeferredEmit('test', { data: i });
      }
    });
  });

  describe('broadcastDeferredEmit', () => {
    bench('broadcastDeferredEmit - single event with listener', async () => {
      const emitter = new SequentialEventEmitter('bench');
      emitter.on('test', () => {});
      emitter.addDeferredEmit('test', { data: 42 });
      await emitter.broadcastDeferredEmit();
    });

    bench('broadcastDeferredEmit - empty queue', async () => {
      const emitter = new SequentialEventEmitter('bench');
      await emitter.broadcastDeferredEmit();
    });

    // Each listener gets its own copy of the payloads, but the last, which gets the one made when they were queued
    const portfolio = new Map([
      ['BTC', { free: 0.5, used: 0, total: 0.5 }],
      ['USDT', { free: 1000, used: 0, total: 1000 }],
    ]);
    for (const count of [1, 2, 3]) {
      bench(`broadcastDeferredEmit - portfolio to ${count} listener(s)`, async () => {
        const emitter = new SequentialEventEmitter('bench');
        for (let i = 0; i < count; i++) emitter.on('portfolioChange', () => {});
        emitter.addDeferredEmit('portfolioChange', portfolio);
        await emitter.broadcastDeferredEmit();
      });
    }
  });

  describe('full workflow', () => {
    bench('full workflow - register, emit, off', async () => {
      const emitter = new SequentialEventEmitter('bench');
      const listener = () => {};
      emitter.on('test', listener);
      await emitter.emit('test', { data: 42 });
      emitter.off('test', listener);
    });
  });
});
