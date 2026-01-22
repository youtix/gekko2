import { Candle } from '@models/candle.types';
import { TradingPair } from '@models/utility.types';
import { Plugin } from '@plugins/plugin';
import { TelegramBot } from '@services/bots/telegram/TelegramBot';
import { debug, getBufferedLogs } from '@services/logger';
import { toISOString } from '@utils/date/date.utils';
import { shallowObjectDiff } from '@utils/object/object.utils';
import { filter, isEmpty } from 'lodash-es';
import { supervisionSchema } from './supervision.schema';
import { Subscription, SUBSCRIPTION_NAMES, SupervisionConfig } from './supervision.types';

export class Supervision extends Plugin {
  private bot: TelegramBot;
  private subscriptions = new Set<Subscription>();
  private cpuThreshold: number;
  private memoryThreshold: number;
  private cpuIntervalTime: number;
  private memoryIntervalTime: number;
  private cpuInterval?: Timer;
  private memoryInterval?: Timer;
  private logMonitorInterval?: Timer;
  private lastCpuUsage = process.cpuUsage();
  private lastCpuCheck = Date.now();
  private lastTimeframeCandle?: Candle;
  private logMonitorIntervalTime: number;
  private lastSentTimestamp = 0;

  constructor({
    name,
    token,
    botUsername,
    cpuThreshold,
    memoryThreshold,
    cpuCheckInterval,
    memoryCheckInterval,
    logMonitoringInterval,
  }: SupervisionConfig) {
    super(name);
    this.bot = new TelegramBot(token, botUsername, this.handleCommand.bind(this));
    this.cpuThreshold = cpuThreshold;
    this.memoryThreshold = memoryThreshold;
    this.cpuIntervalTime = cpuCheckInterval;
    this.memoryIntervalTime = memoryCheckInterval;
    this.logMonitorIntervalTime = logMonitoringInterval;
  }

  private handleCommand(command: string): string {
    switch (command) {
      case '/help':
        return [
          'healthcheck - Check if gekko is up',
          'sub_cpu_check - Check CPU usage',
          'sub_memory_check - Check memory usage',
          'sub_candle_check - Check timeframe candle calculations',
          'sub_monitor_log - Monitor log application',
          'subscribe_all - Subscribe to all notifications',
          'unsubscribe_all - Unsubscribe from all notifications',
          'subscriptions - View current subscriptions',
          'help - Show help information',
        ].join('\n');
      case '/healthcheck':
        return this.isRunning() ? '✅ Gekko is running' : '❌ Gekko is not running';
      case '/subscribe_all':
        SUBSCRIPTION_NAMES.forEach(s => this.toggleSubscription(s, true));
        return 'Subscribed to all monitoring';
      case '/unsubscribe_all':
        SUBSCRIPTION_NAMES.forEach(s => this.toggleSubscription(s, false));
        return 'Unsubscribed from all monitoring';
      case '/subscriptions':
        return this.subscriptions.size ? [...this.subscriptions].join('\n') : 'No subscriptions';
      default:
        if (command.startsWith('/sub_')) {
          const subscription = command.replace('/sub_', '') as Subscription;
          if (!SUBSCRIPTION_NAMES.includes(subscription)) return 'Unknown command';
          const isSubscribed = this.subscriptions.has(subscription);
          this.toggleSubscription(subscription, !isSubscribed);
          return isSubscribed ? `Unsubscribed from ${subscription}` : `Subscribed to ${subscription}`;
        }
        return 'Unknown command';
    }
  }

  private toggleSubscription(subscription: Subscription, subscribe: boolean) {
    if (subscribe) {
      this.subscriptions.add(subscription);
      this.startMonitoring(subscription);
    } else {
      this.subscriptions.delete(subscription);
      this.stopMonitoring(subscription);
    }
  }

  private startMonitoring(subscription: Subscription) {
    switch (subscription) {
      case 'cpu_check':
        this.launchCpuCheck();
        break;
      case 'memory_check':
        this.launchMemoryCheck();
        break;
      case 'candle_check':
        this.launchTimeframeCandleCheck();
        break;
      case 'monitor_log':
        this.startLogMonitoring();
        break;
    }
  }

  private stopMonitoring(subscription: Subscription) {
    switch (subscription) {
      case 'cpu_check':
        this.stopCpuCheck();
        break;
      case 'memory_check':
        this.stopMemoryCheck();
        break;
      case 'candle_check':
        this.stopTimeframeCandleCheck();
        break;
      case 'monitor_log':
        this.stopLogMonitoring();
        break;
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

  private launchTimeframeCandleCheck() {
    debug('supervision', 'Starting Timeframe Candle monitoring');
  }

  private stopTimeframeCandleCheck() {
    debug('supervision', 'Stopped Timeframe Candle monitoring');
  }

  private startLogMonitoring() {
    if (this.logMonitorInterval) return;
    debug('supervision', 'Starting Log monitoring');
    this.lastSentTimestamp = getBufferedLogs().at(-1)?.timestamp ?? 0;
    this.logMonitorInterval = setInterval(() => {
      const logs = getBufferedLogs().filter(l => l.timestamp > this.lastSentTimestamp && ['warn', 'error'].includes(l.level));
      if (logs.length) {
        this.lastSentTimestamp = logs[logs.length - 1].timestamp;
        const message = logs.map(l => `• ${toISOString(l.timestamp)} [${l.level.toUpperCase()}] (${l.tag})\n${l.message}`).join('---\n');
        this.bot.sendMessage(message);
      }
    }, this.logMonitorIntervalTime);
  }

  private stopLogMonitoring() {
    if (!this.logMonitorInterval) return;
    clearInterval(this.logMonitorInterval);
    this.logMonitorInterval = undefined;
    debug('supervision', 'Stopped Log monitoring');
  }

  private async checkTimeframeCandle(symbol: TradingPair) {
    if (!this.lastTimeframeCandle) return;
    const candles = await this.getExchange().fetchOHLCV(symbol, { timeframe: this.timeframe, limit: 100 });
    const exchangeCandle = candles.filter(candle => this.lastTimeframeCandle?.start === candle.start)[0];
    if (!exchangeCandle) return;
    const diff = shallowObjectDiff(exchangeCandle, this.lastTimeframeCandle);
    if (!isEmpty(diff)) {
      const diffMsg = Object.keys(diff)
        .map(key => {
          const k = key as keyof Candle;
          return `${key}: ${exchangeCandle[k]} | ${this.lastTimeframeCandle![k]}`;
        })
        .join('\n');
      this.bot.sendMessage(`⚠️ Timeframe candle mismatch detected:\n${diffMsg}`);
    }
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

  public async onTimeframeCandle(payloads: Candle[]) {
    // Sequential strategy: process each payload in order
    for (const candle of payloads) {
      this.lastTimeframeCandle = candle;
      if (!this.subscriptions.has('candle_check')) continue;
      await this.checkTimeframeCandle(this.symbol);
    }
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
    this.stopTimeframeCandleCheck();
    this.stopLogMonitoring();
  }

  public static getStaticConfiguration() {
    return {
      name: 'Supervision',
      schema: supervisionSchema,
      modes: ['realtime'],
      dependencies: [],
      inject: ['exchange'],
      eventsHandlers: filter(Object.getOwnPropertyNames(Supervision.prototype), p => p.startsWith('on')),
      eventsEmitted: [],
    } as const;
  }
}
