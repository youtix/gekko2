import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { debug } from '@services/logger';
import { supervisionSchema } from './supervision.schema';
import { SupervisionConfig } from './supervision.types';

export class Supervision extends Plugin {
  private bot: TelegramBot;
  private cpuThreshold: number;
  private memoryThreshold: number;
  private cpuIntervalTime: number;
  private memoryIntervalTime: number;
  private cpuInterval?: Timer;
  private memoryInterval?: Timer;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuCheck = Date.now();

  constructor({
    name,
    token,
    cpuThreshold,
    memoryThreshold,
    cpuCheckInterval,
    memoryCheckInterval,
  }: SupervisionConfig) {
    super(name);
    this.bot = new TelegramBot(token, this.handleCommand.bind(this));
    this.cpuThreshold = cpuThreshold;
    this.memoryThreshold = memoryThreshold;
    this.cpuIntervalTime = cpuCheckInterval;
    this.memoryIntervalTime = memoryCheckInterval;
  }

  private handleCommand(command: string): string {
    switch (command) {
      case '/healthcheck':
        return this.isRunning() ? '✅ Gekko is running' : '❌ Gekko is not running';
      case '/launchcpucheck':
        this.launchCpuCheck();
        return '✅ CPU Check started';
      case '/stopcpucheck':
        this.stopCpuCheck();
        return '✅ CPU Check stopped';
      case '/launchmemorycheck':
        this.launchMemoryCheck();
        return '✅ Memory Check started';
      case '/stopmemorycheck':
        this.stopMemoryCheck();
        return '✅ Memory Check stopped';
      default:
        return 'Unknown command';
    }
  }

  private isRunning(): boolean {
    return process.uptime() > 0;
  }

  private launchCpuCheck() {
    if (this.cpuInterval) return;
    debug('supervision', 'Starting CPU monitoring');
    this.cpuInterval = setInterval(() => {
      const usage = this.getCpuUsage();
      if (usage > this.cpuThreshold) {
        this.bot.sendMessage(`⚠️ CPU usage exceeded: ${usage.toFixed(2)}%`);
      }
    }, this.cpuIntervalTime);
  }

  private stopCpuCheck() {
    if (!this.cpuInterval) return;
    clearInterval(this.cpuInterval);
    this.cpuInterval = undefined;
    debug('supervision', 'Stopped CPU monitoring');
  }

  private launchMemoryCheck() {
    if (this.memoryInterval) return;
    debug('supervision', 'Starting Memory monitoring');
    this.memoryInterval = setInterval(() => {
      const usage = this.getMemoryUsage();
      if (usage > this.memoryThreshold) {
        this.bot.sendMessage(`⚠️ Memory usage exceeded: ${usage.toFixed(2)} MB`);
      }
    }, this.memoryIntervalTime);
  }

  private stopMemoryCheck() {
    if (!this.memoryInterval) return;
    clearInterval(this.memoryInterval);
    this.memoryInterval = undefined;
    debug('supervision', 'Stopped Memory monitoring');
  }

  private getCpuUsage(): number {
    const currentUsage = process.cpuUsage(this.lastCpuUsage);
    const currentTime = Date.now();
    const elapsedMicros = (currentTime - this.lastCpuCheck) * 1000;
    const usedMicros = currentUsage.user + currentUsage.system;
    this.lastCpuUsage = process.cpuUsage();
    this.lastCpuCheck = currentTime;
    return (usedMicros / elapsedMicros) * 100;
  }

  private getMemoryUsage(): number {
    const bytes = process.memoryUsage().rss;
    return bytes / (1024 * 1024);
  }

  protected processInit() {
    debug('supervision', 'Supervision plugin initialized');
    this.bot.listen();
  }

  protected processOneMinuteCandle(): void {
    /** Nothing to do */
  }

  protected processFinalize() {
    this.bot.close();
    this.stopCpuCheck();
    this.stopMemoryCheck();
  }

  public static getStaticConfiguration() {
    return {
      schema: supervisionSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: [],
      eventsHandlers: [],
      eventsEmitted: [],
      name: 'Supervision',
    } as const;
  }
}
