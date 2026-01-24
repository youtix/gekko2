import { Candle } from '@models/candle.types';
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

  protected processOneMinuteCandle(candle: Candle): void {
    this.getStorage().addCandle(`${this.asset}/${this.currency}`, candle);
  }

  protected processFinalize(): void {
    this.getStorage().insertCandles(`${this.asset}/${this.currency}`);
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
