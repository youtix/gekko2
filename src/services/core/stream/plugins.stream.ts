import { ApplicationStopError } from '@errors/applicationStop.error';
import { GekkoError } from '@errors/gekko.error';
import { CandleBucket } from '@models/event.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info, error as logError, warning } from '@services/logger';
import { isString, partition } from 'lodash-es';
import { Writable } from 'node:stream';
import { inspect } from 'node:util';

/** A plugin that failed on a bucket, and what it threw */
type PluginFailure = { plugin: Plugin; reason: unknown };

/**
 * A failure in one line, as main() starts reporting it: a GekkoError's message explains it, any other error is named. Not String()
 * for a value that is not an error, which gives '[object Object]' for an object and throws for one without a prototype.
 */
const describeReason = (reason: unknown) => {
  if (reason instanceof GekkoError) return reason.message;
  if (reason instanceof Error) return String(reason); // "<name>: <message>"
  return isString(reason) ? reason : inspect(reason);
};

export class PluginsStream extends Writable {
  private readonly plugins: Plugin[];
  /** Only these are finalised: all the plugins, unless _construct failed part way */
  private readonly initializedPlugins: Plugin[] = [];
  private readonly dummyExchange?: DummyExchange;
  private finalized = false;
  /** Settles once the bucket being written has been handled, whatever the outcome; between two buckets, that of the last one */
  private writing: Promise<void> = Promise.resolve();

  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
    const exchange = inject.exchange();
    if (isDummyExchange(exchange)) this.dummyExchange = exchange;
  }

  public async _construct(callback: (error?: Error | null) => void): Promise<void> {
    try {
      for (const plugin of this.plugins) {
        await plugin.processInitStream();
        this.initializedPlugins.push(plugin);
      }
      callback();
    } catch (error) {
      if (error instanceof Error) callback(error);
      else callback(new Error(`Error when initializing stream plugin: ${error}`));
    }
  }

  public async _write(bucket: CandleBucket, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    const writing = Promise.withResolvers<void>();
    this.writing = writing.promise;
    let otherFailures: PluginFailure[] = []; // The plugins that failed on the bucket besides the one whose failure is thrown
    try {
      // Forward bucket to dummy exchange (if set by user) before all plugins
      await this.dummyExchange?.processOneMinuteBucket(bucket);

      // Forward bucket to all plugins concurrently, each one to its end even when another fails: a failure finalises them all
      const results = await Promise.allSettled(this.plugins.map(plugin => plugin.processInputStream(bucket)));
      const [failure, ...others] = this.rankFailures(results);
      if (failure) {
        otherFailures = others;
        throw failure.reason;
      }

      // Broadcast all deferred events sequentially
      for (const plugin of this.plugins) {
        while (await plugin.broadcastDeferredEmit()) {
          // Continue looping while at least one plugin emitted an event
        }
      }

      // Tell the stream that we're done
      done();
    } catch (error) {
      this.logCloseReason(error);
      for (const { plugin, reason } of otherFailures) {
        logError('stream', `${plugin.emitterName} failed on the bucket as well: ${describeReason(reason)}`);
      }
      this.logDroppedEvents();

      // Finalize all plugins before destroying the stream
      await this.finalizeAllPlugins();

      // The pipeline rejects with this error, which is how main() tells an ApplicationStopError from a crash. _destroy runs at once
      // and waits for this write to settle (below): nothing after this call may wait for the stream to close.
      this.destroy(error instanceof Error ? error : new Error(String(error)));
    } finally {
      writing.resolve();
    }
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    try {
      if (this.finalized) {
        done();
        return;
      }
      await this.finalizeAllPlugins();
      info('stream', 'Gekko is closing the application !');
      done();
    } catch (error) {
      done(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Runs on every teardown. _final and a failed _write finalise the plugins before it, but stream/promises destroys this
   * stream without calling _final when a stream upstream fails, or _construct does: the plugins are finalised here then.
   */
  public async _destroy(error: Nullable<Error>, callback: (error?: Nullable<Error>) => void) {
    // A failure upstream or of _construct: a failed _write has said why and finalised the plugins already
    if (error && !this.finalized) this.logCloseReason(error);
    // A failure upstream destroys the stream at once, whatever the bucket in flight is doing: its handlers run to their end (an order
    // being created, deferred events being delivered) before the plugins are finalised, not under them
    await this.writing;
    // Counted once that bucket is done: what is left waits for a bucket that never comes. A failed _write has named them already.
    if (error && !this.finalized) this.logDroppedEvents();
    try {
      await this.finalizeAllPlugins();
    } catch (finalizeError) {
      warning('stream', `Finalization errors: ${finalizeError instanceof Error ? finalizeError.message : finalizeError}`);
    }
    // Always the error the stream was destroyed with, never a finalisation failure: the pipeline rejects with it
    callback(error);
  }

  /**
   * Says why the application closes, before the plugins are finalised: Supervision's last flush sends it to Telegram then. main()
   * logs the failure in full (stack, causes) only once they are, too late for that flush, so the console shows its message twice.
   */
  private logCloseReason(reason: unknown) {
    if (reason instanceof ApplicationStopError) warning('stream', `Application stopped gracefully: ${reason.message}`);
    else logError('stream', `Gekko is closing the application due to an error: ${describeReason(reason)}`);
  }

  /**
   * The plugins that failed on a bucket, the one whose failure is thrown first. An ApplicationStopError comes before any other failure:
   * it is an orderly stop, which a restart-on-failure supervisor must leave stopped, and main() tells it from a crash by the error the
   * pipeline rejects with. So when one plugin asks to stop and another fails, Gekko stops (exit code 0). Then config order, whichever
   * plugin failed first in time: the failure reported does not depend on timing.
   */
  private rankFailures(results: PromiseSettledResult<void>[]): PluginFailure[] {
    const failures = results.flatMap((result, index) =>
      result.status === 'rejected' ? [{ plugin: this.plugins[index], reason: result.reason }] : [],
    );
    const [stops, others] = partition(failures, ({ reason }) => reason instanceof ApplicationStopError);
    return [...stops, ...others];
  }

  /**
   * Names, per plugin, the deferred events left queued as the application closes on a failure, before the plugins are finalised (for
   * Supervision's last flush): those a failed bucket did not deliver, or, on a failure upstream, those a handler queued on a plugin
   * flushed before it (an order a strategy hook places on a fill), for a bucket that never comes. They are dropped: delivered after a
   * stop (the circuit breaker), they could make the strategy act again, an order hook placing a new order. The final reports may miss
   * them (an orderCompleted, a roundtripCompleted).
   * Not counted: the group whose delivery threw. broadcastDeferredEmit takes a group out of the queue before delivering it, and emit
   * stops at the listener that throws: the listeners wired after it (in config order) never receive it. An EventSubscriber configured
   * after the TradingAdvisor never hears of the orderErrored that tripped the circuit breaker.
   */
  private logDroppedEvents() {
    const dropped = this.plugins.flatMap(plugin => {
      const counts = Array.from(plugin.countUndeliveredPayloads(), ([event, count]) => `${event}: ${count}`);
      return counts.length ? [`${plugin.emitterName} (${counts.join(', ')})`] : [];
    });
    if (dropped.length)
      warning('stream', `Deferred events dropped as the application closes, the final reports may miss them: ${dropped.join(', ')}`);
  }

  /**
   * Safely finalize all plugins whose init completed, ensuring each plugin's cleanup runs
   * regardless of errors in other plugins.
   */
  private async finalizeAllPlugins(): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;

    const results = await Promise.allSettled(this.initializedPlugins.map(plugin => plugin.processCloseStream()));

    const errors = results
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map(r => (r.reason instanceof Error ? r.reason : new Error(String(r.reason))));

    if (errors.length > 0) {
      warning('stream', `Finalization errors: ${errors.map(e => e.message).join(', ')}`);
    }
  }
}
