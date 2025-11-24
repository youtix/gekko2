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

  it('should handle deferred events', async () => {
    const emitter = new SequentialEventEmitter('test');
    const callOrder: string[] = [];

    emitter.on('deferred', payload => {
      callOrder.push(payload as string);
    });

    emitter.addDeferredEmit('deferred', 'payload1');
    emitter.addDeferredEmit('deferred', 'payload2');

    expect(callOrder).toEqual([]);

    await emitter.broadcastDeferredEmit();
    expect(callOrder).toEqual(['payload1']);

    await emitter.broadcastDeferredEmit();
    expect(callOrder).toEqual(['payload1', 'payload2']);
  });

  it('should return false when no deferred events', async () => {
    const emitter = new SequentialEventEmitter('test');
    const result = await emitter.broadcastDeferredEmit();
    expect(result).toBe(false);
  });
});
