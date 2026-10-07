import { mock } from 'bun:test';
import type { Writable } from 'node:stream';
import * as streamPromises from 'stream/promises';
import { MockHeart } from '../mocks/heart.mock';

/**
 * Ends the realtime runs of the e2e flows. A realtime run never ends by itself: the bot runs until its process exits, which drops
 * whatever the run left scheduled. The tests share one process, so each one ends its run here before the next one starts. Left
 * running, a run would go on through the next tests: its orders polling and moving, its Telegram bots posting into the shared
 * fetcher mock, and the prototype patch of one test reaching the orders of another.
 */

// Taken before trackRealtimeRuns mocks the module: the mock patches this very namespace
const { pipeline: runPipeline, ...otherStreamPromises } = streamPromises;
const setIntervalOfProcess = globalThis.setInterval;

let run: { sink: Writable; ended: Promise<unknown> } | undefined;
/** The intervals created since the last run ended */
const intervals = new Set<ReturnType<typeof setInterval>>();
let isTrackingIntervals = false;

/**
 * Lets endRealtimeRun end the run a test starts: stream/promises is mocked by a copy whose pipeline() keeps hold of the stream
 * pipeline it starts, the one gekkoPipeline() runs, and every interval created from now on is recorded. To be called next to the
 * other mocks of the test file, before the pipeline is imported. Both last for the rest of the process.
 */
export const trackRealtimeRuns = () => {
  mock.module('stream/promises', () => ({
    ...otherStreamPromises,
    pipeline: (...streams: any[]) => {
      const ended = (runPipeline as (...args: any[]) => Promise<unknown>)(...streams);
      run = { sink: streams.at(-1), ended };
      return ended;
    },
  }));

  if (isTrackingIntervals) return;
  isTrackingIntervals = true;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const interval = setIntervalOfProcess(...args);
    intervals.add(interval);
    return interval;
  }) as typeof setInterval;
};

/**
 * Ends the run in progress as the process ends a real one, and waits until it is over. Its last stream, the PluginsStream, is
 * destroyed: the stream pipeline is torn down and the plugins are finalised, which settles its promise. Then the intervals created
 * since the previous run are cleared, among them the polls of the orders still open: the Trader leaves them open when it is
 * finalised, as they stay on the exchange when Gekko stops. Nothing to destroy when the run has ended already (a stop).
 */
export const endRealtimeRun = async () => {
  const ending = run;
  run = undefined;
  if (ending) {
    ending.sink.destroy();
    await ending.ended.catch(() => undefined); // Rejected with the premature close, or with what ended the run
  }
  for (const interval of intervals) clearInterval(interval);
  intervals.clear();
  MockHeart.stopAll();
};
