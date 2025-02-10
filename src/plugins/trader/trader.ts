import { Plugin } from '@plugins/plugin';
import { filter } from 'lodash-es';
import { traderSchema } from './trader.schema';

export class Trader extends Plugin {
  protected processCandle(): void {
    throw new Error('Method not implemented.');
  }

  protected processFinalize(): void {
    throw new Error('Method not implemented.');
  }

  public static getStaticConfiguration() {
    return {
      schema: traderSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(Trader.prototype), (p) =>
        p.startsWith('on'),
      ),
      eventsEmitted: [],
      name: Trader.name,
    };
  }
}
