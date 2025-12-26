import { describe, expect, it } from 'vitest';
import { SequentialEventEmitter } from './sequentialEventEmitter';

describe('SequentialEventEmitter', () => {
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

  it('should batch deferred events by name and emit as arrays', async () => {
    const emitter = new SequentialEventEmitter('test');
    const receivedPayloads: string[][] = [];

    emitter.on('deferred', (payloads: string[]) => {
      receivedPayloads.push(payloads);
    });

    emitter.addDeferredEmit('deferred', 'payload1');
    emitter.addDeferredEmit('deferred', 'payload2');
    emitter.addDeferredEmit('deferred', 'payload3');

    expect(receivedPayloads).toEqual([]);

    await emitter.broadcastDeferredEmit();
    expect(receivedPayloads).toEqual([['payload1', 'payload2', 'payload3']]);
  });

  it('should handle multiple different event names separately', async () => {
    const emitter = new SequentialEventEmitter('test');
    const eventAPayloads: string[][] = [];
    const eventBPayloads: string[][] = [];

    emitter.on('eventA', (payloads: string[]) => {
      eventAPayloads.push(payloads);
    });
    emitter.on('eventB', (payloads: string[]) => {
      eventBPayloads.push(payloads);
    });

    emitter.addDeferredEmit('eventA', 'a1');
    emitter.addDeferredEmit('eventB', 'b1');
    emitter.addDeferredEmit('eventA', 'a2');
    emitter.addDeferredEmit('eventB', 'b2');

    await emitter.broadcastDeferredEmit();
    await emitter.broadcastDeferredEmit();

    expect(eventAPayloads).toEqual([['a1', 'a2']]);
    expect(eventBPayloads).toEqual([['b1', 'b2']]);
  });

  it('should return false when no deferred events', async () => {
    const emitter = new SequentialEventEmitter('test');
    const result = await emitter.broadcastDeferredEmit();
    expect(result).toBe(false);
  });
});
