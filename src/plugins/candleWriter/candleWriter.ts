import { CandleBucket } from '@models/event.types';
import { Plugin } from '@plugins/plugin';
import { candleWriterSchema } from './candleWriter.schema';
import { CandleWriterConfig } from './candleWriter.types';

export class CandleWriter extends Plugin {
  constructor({ name }: CandleWriterConfig) {
    super(name);
  }

  // --------------------------------------------------------------------------
  //                           PLUGIN LIFECYCLE HOOKS
  // --------------------------------------------------------------------------

  protected processInit(): void {
    /* noop */
  }

  protected processOneMinuteBucket(bucket: CandleBucket): void {
    this.getStorage().addCandle(bucket);
  }

  protected processFinalize(): void {
    for (const pair of this.pairs) this.getStorage().insertCandles(pair);
    this.getStorage().close();
  }

  public static getStaticConfiguration() {
    return {
      name: 'CandleWriter',
      schema: candleWriterSchema,
      modes: ['realtime', 'importer'],
      dependencies: [],
      inject: ['storage'],
      eventsHandlers: [],
      eventsEmitted: [],
    } as const;
  }
}
