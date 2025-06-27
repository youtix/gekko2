import { Plugin } from '@plugins/plugin';
import { heapStats } from 'bun:jsc';
import { filter } from 'lodash-es';
import { appendFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { error } from '@services/logger';
import { heapStatsMonitorSchema } from './heapStatsMonitor.schema';
import { HeapStatsMonitorConfig } from './heapStatsMonitor.types';

type HeapStats = ReturnType<typeof heapStats>;

export class HeapStatsMonitor extends Plugin {
  private adviceCount: number;
  private interval: number;
  private metrics: (keyof HeapStats)[];
  private readonly filePath: string;
  private readonly header: string;
  private readonly defaultMetrics: (keyof HeapStats)[] = [
    'heapSize',
    'heapCapacity',
    'extraMemorySize',
    'objectCount',
    'protectedObjectCount',
  ];

  constructor({ name, interval = 1, metrics, filePath, fileName }: HeapStatsMonitorConfig) {
    super(name);
    this.adviceCount = 0;
    this.interval = interval;
    this.metrics = (metrics as (keyof HeapStats)[]) ?? this.defaultMetrics;
    this.filePath = path.join(filePath ?? process.cwd(), fileName ?? 'heap_stats.csv');
    this.header = (this.metrics as string[]).join(';') + '\n';
  }

  public onStrategyAdvice() {
    this.adviceCount++;
    if (this.adviceCount % this.interval !== 0) return;
    const stats = heapStats();
    const line = this.metrics.map(m => String((stats as any)[m])).join(';') + '\n';
    try {
      const release = this.getFs().lockSync(this.filePath, { retries: 5 });
      try {
        appendFileSync(this.filePath, line, 'utf8');
      } finally {
        release();
      }
    } catch (err) {
      error('heap stats monitor', `write error: ${err}`);
    }
  }

  protected processInit(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const needsHeader = !existsSync(this.filePath) || statSync(this.filePath).size === 0;
      if (needsHeader) {
        const release = this.getFs().lockSync(this.filePath, { retries: 3 });
        try {
          if (!existsSync(this.filePath) || statSync(this.filePath).size === 0) {
            writeFileSync(this.filePath, this.header, 'utf8');
          }
        } finally {
          release();
        }
      }
    } catch (err) {
      error('heap stats monitor', `setup error: ${err}`);
    }
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
      inject: ['fs'],
      eventsHandlers: filter(Object.getOwnPropertyNames(HeapStatsMonitor.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
      name: 'HeapStatsMonitor',
    } as const;
  }
}
