import { describe, expect, it } from 'bun:test';
import { Readable, Writable } from 'node:stream';
import { endRealtimeRun, trackRealtimeRuns } from './realtimeRun.helper';

trackRealtimeRuns();

describe('realtimeRun.helper', () => {
  // A stream pipeline as gekkoPipeline() runs it in realtime: from a source that never ends into a sink
  const startRun = async () => {
    const { pipeline } = await import('stream/promises');
    const sink = new Writable({ objectMode: true, write: (_chunk, _encoding, done) => done() });
    let isSettled = false;
    pipeline(new Readable({ objectMode: true, read() {} }), sink).catch(() => (isSettled = true));
    return { sink, isSettled: () => isSettled };
  };

  it('should destroy the last stream of the run in progress', async () => {
    const { sink } = await startRun();
    await endRealtimeRun();
    expect(sink.destroyed).toBe(true);
  });

  it('should return once the run is over', async () => {
    const { isSettled } = await startRun();
    await endRealtimeRun();
    expect(isSettled()).toBe(true);
  });

  it('should clear the intervals created since the previous run ended', async () => {
    let ticks = 0;
    setInterval(() => ticks++, 1);
    await endRealtimeRun();
    const ticksAtEnd = ticks;
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(ticks).toBe(ticksAtEnd);
  });
});
