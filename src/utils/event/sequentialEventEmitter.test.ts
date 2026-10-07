import { noop } from 'lodash-es';
import { describe, expect, it } from 'vitest';
import { SequentialEventEmitter } from './sequentialEventEmitter';

type Delivery = [event: string, payloads: unknown[]];

/** An emitter whose listeners of `events` log every delivery they receive, in the order they receive them */
const createRecordingEmitter = (events: string[]) => {
  const emitter = new SequentialEventEmitter('test');
  const deliveries: Delivery[] = [];
  for (const event of events) {
    emitter.on(event, (payloads: unknown[]) => {
      deliveries.push([event, payloads]);
    });
  }
  return { emitter, deliveries };
};

/** Broadcasts until nothing is queued, as PluginsStream does after every bucket */
const broadcastAll = async (emitter: SequentialEventEmitter) => {
  while (await emitter.broadcastDeferredEmit()) {
    // Until the queue is empty
  }
};

describe('SequentialEventEmitter', () => {
  describe('emit', () => {
    it('should execute listeners sequentially and await them', async () => {
      const emitter = new SequentialEventEmitter('test');
      const callOrder: string[] = [];

      emitter.on('test', async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        callOrder.push('first');
      });

      emitter.on('test', () => {
        callOrder.push('second');
      });

      await emitter.emit('test');

      expect(callOrder).toEqual(['first', 'second']);
    });

    it('should resolve when the event has no listener', async () => {
      await expect(new SequentialEventEmitter('test').emit('unknown', 'payload')).resolves.toBeUndefined();
    });
  });

  describe('off', () => {
    it('should stop calling the listener removed, and only it', async () => {
      const emitter = new SequentialEventEmitter('test');
      const calls: string[] = [];
      const removed = () => {
        calls.push('removed');
      };
      emitter.on('test', removed);
      emitter.on('test', () => {
        calls.push('kept');
      });

      emitter.off('test', removed);
      await emitter.emit('test');

      expect(calls).toEqual(['kept']);
    });

    it('should do nothing for an event without listener', () => {
      expect(() => new SequentialEventEmitter('test').off('unknown', noop)).not.toThrow();
    });
  });

  describe('deferred events', () => {
    it('should not deliver a deferred event before it is broadcast', () => {
      const { emitter, deliveries } = createRecordingEmitter(['a']);
      emitter.addDeferredEmit('a', 'a1');
      expect(deliveries).toEqual([]);
    });

    it.each`
      order                                                     | queued                                                  | delivered
      ${'the payloads of one event together'}                   | ${[['a', 'a1'], ['a', 'a2'], ['a', 'a3']]}              | ${[['a', ['a1', 'a2', 'a3']]]}
      ${'the payloads queued in a row under an event together'} | ${[['a', 'a1'], ['a', 'a2'], ['b', 'b1']]}              | ${[['a', ['a1', 'a2']], ['b', ['b1']]]}
      ${'interleaved events in the order they were queued'}     | ${[['a', 'a1'], ['b', 'b1'], ['a', 'a2'], ['b', 'b2']]} | ${[['a', ['a1']], ['b', ['b1']], ['a', ['a2']], ['b', ['b2']]]}
    `('should deliver $order', async ({ queued, delivered }: { queued: [string, string][]; delivered: Delivery[] }) => {
      const { emitter, deliveries } = createRecordingEmitter(['a', 'b']);
      for (const [event, payload] of queued) emitter.addDeferredEmit(event, payload);

      await broadcastAll(emitter);

      expect(deliveries).toEqual(delivered);
    });

    it('should deliver a payload queued during a delivery afterwards, not with the payloads being delivered', async () => {
      const { emitter, deliveries } = createRecordingEmitter(['a']);
      emitter.on('a', (payloads: string[]) => {
        if (payloads.includes('a1')) emitter.addDeferredEmit('a', 'a2');
      });
      emitter.addDeferredEmit('a', 'a1');

      await broadcastAll(emitter);

      expect(deliveries).toEqual([
        ['a', ['a1']],
        ['a', ['a2']],
      ]);
    });

    it.each`
      position    | index
      ${'first'}  | ${0}
      ${'second'} | ${1}
    `('should deliver a copy of the $position payload of a group, unchanged by a later change to the original', async ({ index }) => {
      const { emitter, deliveries } = createRecordingEmitter(['a']);
      const payloads = [{ value: 1 }, { value: 2 }];
      for (const payload of payloads) emitter.addDeferredEmit('a', payload);

      payloads[index].value = 0;
      await broadcastAll(emitter);

      expect(deliveries).toEqual([['a', [{ value: 1 }, { value: 2 }]]]);
    });

    it('should resolve to true for each group it delivers, then to false', async () => {
      const { emitter } = createRecordingEmitter(['a', 'b']);
      emitter.addDeferredEmit('a', 'a1');
      emitter.addDeferredEmit('b', 'b1');

      const results = [await emitter.broadcastDeferredEmit(), await emitter.broadcastDeferredEmit(), await emitter.broadcastDeferredEmit()];

      expect(results).toEqual([true, true, false]);
    });

    it('should return false when no deferred events', async () => {
      const emitter = new SequentialEventEmitter('test');
      const result = await emitter.broadcastDeferredEmit();
      expect(result).toBe(false);
    });
  });

  describe('countUndeliveredPayloads', () => {
    it.each`
      counted                                              | queued                                                  | counts
      ${'nothing when nothing is queued'}                  | ${[]}                                                   | ${[]}
      ${'the payloads of every group queued under a name'} | ${[['a', 'a1'], ['b', 'b1'], ['a', 'a2'], ['a', 'a3']]} | ${[['a', 3], ['b', 1]]}
      ${'no event nobody listens to'}                      | ${[['a', 'a1'], ['unheard', 'u1']]}                     | ${[['a', 1]]}
    `('should count $counted', ({ queued, counts }: { queued: [string, string][]; counts: [string, number][] }) => {
      const { emitter } = createRecordingEmitter(['a', 'b']);
      for (const [event, payload] of queued) emitter.addDeferredEmit(event, payload);

      expect(Array.from(emitter.countUndeliveredPayloads())).toEqual(counts);
    });

    it('should not count an event whose listeners were all removed', () => {
      const emitter = new SequentialEventEmitter('test');
      emitter.on('a', noop);
      emitter.off('a', noop);
      emitter.addDeferredEmit('a', 'a1');

      expect(emitter.countUndeliveredPayloads().size).toBe(0);
    });

    it('should count nothing once the queue is broadcast', async () => {
      const { emitter } = createRecordingEmitter(['a']);
      emitter.addDeferredEmit('a', 'a1');

      await broadcastAll(emitter);

      expect(emitter.countUndeliveredPayloads().size).toBe(0);
    });

    it('should leave the payloads it counts queued', async () => {
      const { emitter, deliveries } = createRecordingEmitter(['a']);
      emitter.addDeferredEmit('a', 'a1');

      emitter.countUndeliveredPayloads();
      await broadcastAll(emitter);

      expect(deliveries).toEqual([['a', ['a1']]]);
    });
  });
});
