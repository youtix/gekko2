import { MissingBrokerFeatureError } from '@errors/broker/missingBrokerFeature.error';
import { Candle } from '@models/types/candle.types';
import { BrokerConfig } from '@models/types/configuration.types';
import { Ticker } from '@models/types/ticker.types';
import { Trade } from '@models/types/trade.types';
import { config } from '@services/configuration/configuration';
import { logger } from '@services/logger';
import ccxt, { Exchange } from 'ccxt';
import {
  BROKER_MAX_RETRIES_ON_FAILURE,
  BROKER_MAX_RETRIES_ON_FAILURE_DELAY,
  INTERVAL_BETWEEN_CALLS_IN_MS,
} from './broker.const';

export abstract class Broker {
  protected broker: Exchange;
  protected brokerName: string;
  protected symbol: string;
  protected interval: number;

  constructor({ name, interval }: BrokerConfig) {
    const { asset, currency } = config.getWatch();
    this.broker = new ccxt[name]();
    if (!this.broker.has['fetchTrades']) throw new MissingBrokerFeatureError(name, 'fetchTrades');
    if (!this.broker.has['fetchOHLCV']) throw new MissingBrokerFeatureError(name, 'fetchOHLCV');
    this.broker.options['maxRetriesOnFailure'] = 0; // we handle it manualy
    this.brokerName = name;
    this.symbol = `${asset}/${currency}`;
    this.interval = interval ?? INTERVAL_BETWEEN_CALLS_IN_MS;
  }

  public getBrokerName() {
    return this.brokerName;
  }
  public getInterval() {
    return this.interval;
  }
  public async getTicker(): Promise<Ticker> {
    return this.retry<Ticker>(() => {
      return this.fetchTicker();
    });
  }
  public async getOHLCV(from?: EpochTimeStamp): Promise<Candle[]> {
    return this.retry<Candle[]>(() => {
      return this.fetchOHLCV(from);
    });
  }
  public async getTrades(): Promise<Trade[]> {
    return this.retry<Trade[]>(() => {
      return this.fetchTrades();
    });
  }

  private async retry<T>(fn: () => Promise<T>, currRetry = 1): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Error)
        logger.error(`${this.brokerName} call failed due to ${error.message}`);
      if (currRetry > BROKER_MAX_RETRIES_ON_FAILURE) throw error;
      await this.broker.sleep(BROKER_MAX_RETRIES_ON_FAILURE_DELAY);
      return this.retry(fn, currRetry + 1);
    }
  }

  protected abstract fetchTicker(): Promise<Ticker>;
  protected abstract fetchOHLCV(from?: EpochTimeStamp): Promise<Candle[]>;
  protected abstract fetchTrades(): Promise<Trade[]>;
}
