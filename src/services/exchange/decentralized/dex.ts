import { ExchangeConfig } from '@models/configuration.types';
import { Exchange } from '../exchange';

export interface NetworkConfiguration {
  network?: string;
  chainId?: number;
}

export abstract class DecentralizedExchange<TConfig extends ExchangeConfig = ExchangeConfig> extends Exchange {
  protected readonly network?: string;
  protected readonly chainId?: number;

  constructor(config: TConfig) {
    super(config);
    const resolved = this.resolveNetworkConfiguration(config);
    this.network = resolved?.network;
    this.chainId = resolved?.chainId;
  }

  protected abstract resolveNetworkConfiguration(config: TConfig): NetworkConfiguration | undefined;

  protected getNetwork() {
    return this.network;
  }

  protected getChainId() {
    return this.chainId;
  }
}
