import { Plugin } from '@plugins/plugin';
import { heapStats } from 'bun:jsc';
import { filter } from 'lodash-es';
import { heapStatsMonitorSchema } from './heapStatsMonitor.schema';
import { HeapStatsMonitorConfig } from './heapStatsMonitor.types';

type HeapStats = ReturnType<typeof heapStats>;

export class HeapStatsMonitor extends Plugin {
  private adviceCount: number;
  private interval: number;
  private metrics: (keyof HeapStats)[];
  private readonly defaultMetrics: (keyof HeapStats)[] = [
    'heapSize',
    'heapCapacity',
    'extraMemorySize',
    'objectCount',
    'protectedObjectCount',
  ];

  constructor({ name, interval = 1, metrics }: HeapStatsMonitorConfig) {
    super(name);
    this.adviceCount = 0;
    this.interval = interval;
    this.metrics = (metrics as (keyof HeapStats)[]) ?? this.defaultMetrics;
  }

  public onStrategyAdvice() {
    this.adviceCount++;
    if (this.adviceCount % this.interval !== 0) return;
    const stats = heapStats();
    const table: Record<string, number> = {};
    for (const m of this.metrics) {
      table[m] = (stats as any)[m];
    }
    // eslint-disable-next-line no-console
    console.table(table);
  }

  protected processInit(): void {
    /* noop */
  }

  protected processOneMinuteCandle(): void {
    /* noop */
  }

  protected processFinalize(): void {
    /* noop */
  }

  public static getStaticConfiguration() {
    return {
      schema: heapStatsMonitorSchema,
      modes: ['realtime', 'backtest'],
      dependencies: [],
      inject: [],
      eventsHandlers: filter(Object.getOwnPropertyNames(HeapStatsMonitor.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
      name: 'HeapStatsMonitor',
    } as const;
  }
}
