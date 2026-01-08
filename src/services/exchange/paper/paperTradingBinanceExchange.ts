import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { config } from '@services/configuration/configuration';
import { info } from '@services/logger';
import { CCXTExchange } from '../ccxtExchange';
import { DummyCentralizedExchange } from '../dummy/dummyCentralizedExchange';
import { DummyCentralizedExchangeConfig } from '../dummy/dummyCentralizedExchange.types';
import { DummyExchange, Exchange, FetchOHLCVParams, MarketData, OrderSettledCallback } from '../exchange.types';
import { PaperTradingBinanceExchangeConfig } from './paperTradingBinanceExchange.types';

/**
 * Paper Trading Exchange for Binance
 *
 * This exchange reads real market data from Binance (public endpoints, no authentication required)
 * while simulating all trades locally. It's designed for "screener mode" - testing strategies
 * with real-time data without risking real capital.
 *
 * Read Operations: Delegated to CCXTExchange (fetchOHLCV, fetchTicker, onNewCandle, etc.)
 * Write Operations: Simulated locally via DummyCentralizedExchange (createLimitOrder, etc.)
 */
export class PaperTradingBinanceExchange implements Exchange, DummyExchange {
  private readonly realExchange: CCXTExchange;
  private readonly exchangeConfig: PaperTradingBinanceExchangeConfig;
  private simulatedExchange!: DummyCentralizedExchange;

  constructor(exchangeConfig: PaperTradingBinanceExchangeConfig) {
    // Use CCXTExchange for read operations (public endpoints only, no auth required)
    this.realExchange = new CCXTExchange({
      name: 'binance',
      verbose: exchangeConfig.verbose,
      sandbox: false,
      exchangeSynchInterval: exchangeConfig.exchangeSynchInterval,
      orderSynchInterval: exchangeConfig.orderSynchInterval,
    });
    this.exchangeConfig = exchangeConfig;
  }

  /* -------------------------------------------------------------------------- */
  /*                              INITIALIZATION                                */
  /* -------------------------------------------------------------------------- */

  public async loadMarkets(): Promise<void> {
    // Load real market data from Binance via CCXTExchange
    await this.realExchange.loadMarkets();

    // Build market data from real exchange, with optional fee overrides
    const marketData = this.buildMarketData();

    // Get current ticker for initial price
    const ticker = await this.realExchange.fetchTicker();

    // Initialize simulated exchange with real market constraints
    this.simulatedExchange = new DummyCentralizedExchange({
      name: 'dummy-cex',
      marketData,
      simulationBalance: this.exchangeConfig.simulationBalance,
      initialTicker: ticker,
      exchangeSynchInterval: this.exchangeConfig.exchangeSynchInterval,
      orderSynchInterval: this.exchangeConfig.orderSynchInterval,
    });

    info('exchange', '🔶 PAPER TRADING MODE - Using simulated orders with real market data');
    info(
      'exchange',
      `Initial balance: ${this.exchangeConfig.simulationBalance.asset} ${config.getWatch().asset} / ${this.exchangeConfig.simulationBalance.currency} ${config.getWatch().currency}`,
    );
  }

  private buildMarketData(): DummyCentralizedExchangeConfig['marketData'] {
    return {
      ...this.realExchange.getMarketData(),
      ...(this.exchangeConfig.feeOverride && { fee: this.exchangeConfig.feeOverride }),
    } as DummyCentralizedExchangeConfig['marketData'];
  }

  /* -------------------------------------------------------------------------- */
  /*                    UNAUTHENTICATED OPERATIONS (via CCXTExchange)           */
  /* -------------------------------------------------------------------------- */

  public async fetchOHLCV(params?: FetchOHLCVParams) {
    return this.realExchange.fetchOHLCV(params ?? {});
  }

  public async fetchTicker() {
    return this.realExchange.fetchTicker();
  }

  public onNewCandle(onNewCandle: (candle: Candle) => void) {
    return this.realExchange.onNewCandle(onNewCandle);
  }

  public getMarketData(): MarketData {
    return this.realExchange.getMarketData();
  }

  /* -------------------------------------------------------------------------- */
  /*                   AUTHENTICATED OPERATIONS (Simulated Locally)             */
  /* -------------------------------------------------------------------------- */

  public async fetchBalance(): Promise<Portfolio> {
    return this.simulatedExchange.fetchBalance();
  }

  public async createLimitOrder(
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState> {
    return this.simulatedExchange.createLimitOrder(side, amount, price, onSettled);
  }

  public async createMarketOrder(side: OrderSide, amount: number): Promise<OrderState> {
    return this.simulatedExchange.createMarketOrder(side, amount);
  }

  public async cancelOrder(id: string): Promise<OrderState> {
    return this.simulatedExchange.cancelOrder(id);
  }

  public async fetchOrder(id: string): Promise<OrderState> {
    return this.simulatedExchange.fetchOrder(id);
  }

  public async fetchMyTrades(from?: EpochTimeStamp): Promise<Trade[]> {
    return this.simulatedExchange.fetchMyTrades(from);
  }

  /* -------------------------------------------------------------------------- */
  /*                          DUMMY EXCHANGE INTERFACE                          */
  /* -------------------------------------------------------------------------- */

  public async processOneMinuteCandle(candle: Candle): Promise<void> {
    return this.simulatedExchange.processOneMinuteCandle(candle);
  }

  /* -------------------------------------------------------------------------- */
  /*                                IDENTIFICATION                              */
  /* -------------------------------------------------------------------------- */

  public getExchangeName(): string {
    return 'paper-binance';
  }
}
