import { Candle } from '@models/types/candle.types';
import { Plugin } from '@plugins/plugin';
import { candleWriterSchema } from './candleWriter.schema';
import { CandleWriterConfig } from './candleWriter.types';

export class CandleWriter extends Plugin {
  constructor({ name }: CandleWriterConfig) {
    super(name);
  }

  protected processCandle(candle: Candle): void {
    this.getStorage().addCandle(candle);
  }

  protected processFinalize(): void {
    this.getStorage().insertCandles();
    this.getStorage().close();
  }

  public static getStaticConfiguration() {
    return {
      schema: candleWriterSchema,
      modes: ['realtime', 'importer'],
      dependencies: [],
      inject: ['storage'],
      eventsHandlers: [],
      eventsEmitted: [],
      name: 'CandleWriter',
    };
  }
}
