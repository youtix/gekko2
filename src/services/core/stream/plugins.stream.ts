import { ApplicationStopError } from '@errors/applicationStop.error';
import { CandleBucket } from '@models/event.types';
import { Nullable } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { DummyExchange } from '@services/exchange/exchange.types';
import { isDummyExchange } from '@services/exchange/exchange.utils';
import { inject } from '@services/injecter/injecter';
import { info, error as logError, warning } from '@services/logger';
import { Writable } from 'node:stream';

const toError = (value: unknown) => (value instanceof Error ? value : new Error(String(value)));

export class PluginsStream extends Writable {
  private readonly plugins: Plugin[];
  /** Only these are finalised: all the plugins, unless _construct failed or the stream was destroyed part way */
  private readonly initializedPlugins: Plugin[] = [];
  private readonly dummyExchange?: DummyExchange;
  /** The bucket being processed. _destroy waits for it, so that no plugin is finalised in the middle of a bucket. */
  private pendingWrite?: Promise<void>;
  /** Started by whichever of _final, a failed bucket and _destroy comes first; the others wait for the same promise. */
  private finalization?: Promise<void>;
  /** The error a bucket failed with. The stream reports it even when a stream upstream fails while the plugins are finalised. */
  private caughtError?: Error;

  constructor(plugins: Plugin[]) {
    super({ objectMode: true });
    this.plugins = plugins;
    const exchange = inject.exchange();
    if (isDummyExchange(exchange)) this.dummyExchange = exchange;
  }

  /**
   * The error a bucket failed with, if any. pipeline() rejects with the first error of the chain, so when a stream upstream
   * fails while the plugins are finalised after a failed bucket, it rejects with the upstream error, not this one: the
   * caller has to prefer this one to tell an ApplicationStopError from a crash.
   */
  public get failure(): Error | undefined {
    return this.caughtError;
  }

  public async _construct(callback: (error?: Error | null) => void): Promise<void> {
    try {
      for (const plugin of this.plugins) {
        // Destroyed meanwhile (a stream upstream failed): the plugins left would be finalised as soon as initialised
        if (this.destroyed) break;
        await plugin.processInitStream();
        this.initializedPlugins.push(plugin);
      }
      callback();
    } catch (error) {
      if (error instanceof Error) callback(error);
      else callback(new Error(`Error when initializing stream plugin: ${error}`));
    }
  }

  public _write(bucket: CandleBucket, _: BufferEncoding, done: (error?: Nullable<Error>) => void) {
    this.pendingWrite = this.processBucket(bucket).then(
      () => done(),
      (error: unknown) => this.stopOnError(toError(error)),
    );
  }

  public async _final(done: (error?: Nullable<Error>) => void) {
    // Only reached after every bucket succeeded: a failed bucket destroys the stream, which then never calls _final
    try {
      await this.finalizeAllPlugins();
      info('stream', 'Gekko is closing the application !');
      done();
    } catch (error) {
      done(toError(error));
    }
  }

  /**
   * Runs on every teardown. _final and a failed bucket finalise the plugins before it, but stream/promises destroys this
   * stream without calling _final when a stream upstream fails, or _construct does: the plugins are finalised here then,
   * once the bucket in progress, if any, is done.
   */
  public async _destroy(error: Nullable<Error>, callback: (error?: Nullable<Error>) => void) {
    await this.pendingWrite; // Never rejects: a failed bucket is handled by stopOnError
    try {
      await this.finalizeAllPlugins(this.caughtError ?? error ?? undefined);
    } catch (finalizeError) {
      warning('stream', `Finalization errors: ${toError(finalizeError).message}`);
    }
    // The error of a failed bucket, or else the one the stream was destroyed with, never a finalisation failure
    callback(this.caughtError ?? error);
  }

  private async processBucket(bucket: CandleBucket) {
    // Forward bucket to dummy exchange (if set by user) before all plugins
    await this.dummyExchange?.processOneMinuteBucket(bucket);

    // Forward bucket to all plugins concurrently, and let them all finish before the plugins can be finalised
    const results = await Promise.allSettled(this.plugins.map(plugin => plugin.processInputStream(bucket)));
    const [firstFailure, ...otherFailures] = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (firstFailure) {
      for (const { reason } of otherFailures) logError('stream', `Another plugin failed on the same bucket: ${toError(reason).message}`);
      throw firstFailure.reason;
    }

    // Broadcast the deferred events plugin by plugin, in config order. Each call sends one event name with all its
    // payloads, and returns false once the plugin's queue is empty.
    for (const plugin of this.plugins) {
      while (await plugin.broadcastDeferredEmit());
    }
  }

  private async stopOnError(error: Error) {
    this.caughtError = error;
    // main() logs the reason of an ApplicationStopError once the pipeline rejects with it
    if (error instanceof ApplicationStopError) warning('stream', 'Application stop requested, finalizing the plugins');
    else logError('stream', `Gekko is closing the application due to an error: ${error.message}`);

    // Finalize all plugins before destroying the stream. A failed finalisation is logged by _destroy, which waits for it too.
    await this.finalizeAllPlugins(error).catch(() => undefined);

    // The pipeline rejects with this error, which is how main() tells an ApplicationStopError from a crash
    this.destroy(error);
  }

  /**
   * Safely finalize all plugins whose init completed, ensuring each plugin's cleanup runs
   * regardless of errors in other plugins.
   */
  private finalizeAllPlugins(failure?: Error): Promise<void> {
    this.finalization ??= this.finalizePlugins(failure);
    return this.finalization;
  }

  /** `failure` tells the plugins that the run stops before its end: their final reports then describe a partial run */
  private async finalizePlugins(failure?: Error): Promise<void> {
    const results = await Promise.allSettled(this.initializedPlugins.map(plugin => plugin.processCloseStream(failure)));

    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected').map(r => toError(r.reason));

    if (errors.length > 0) {
      warning('stream', `Finalization errors: ${errors.map(e => e.message).join(', ')}`);
    }
  }
}
