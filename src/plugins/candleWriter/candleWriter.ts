import { PluginError } from '@errors/plugin/plugin.error';
import { Candle } from '@models/types/candle.types';
import { Plugin } from '@plugins/plugin';
import { candleWriterSchema } from './candleWriter.schema';
import { CandleWriterConfig } from './candleWriter.types';

export class CandleWriter extends Plugin {
  constructor({ name }: CandleWriterConfig) {
    super(name);
  }

  protected processCandle(candle: Candle): void {
    if (!this.storage) throw new PluginError(this.pluginName, 'Missing storage');
    this.storage.addCandle(candle);
  }

  protected processFinalize(): void {
    if (!this.storage) throw new PluginError(this.pluginName, 'Missing storage');
    this.storage.insertCandles();
    this.storage.close();
  }

  public static getStaticConfiguration() {
    return {
      schema: candleWriterSchema,
      modes: ['realtime', 'importer'],
      dependencies: [],
      inject: ['storage'],
      eventsHandlers: [],
      eventsEmitted: [],
      name: CandleWriter.name,
    };
  }
}
