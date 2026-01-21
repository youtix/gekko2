import { Candle } from '@models/candle.types';
import { OrderSide, OrderState } from '@models/order.types';
import { Portfolio } from '@models/portfolio.types';
import { Trade } from '@models/trade.types';
import { Symbol } from '@models/utility.types';
import { config } from '@services/configuration/configuration';
import { info } from '@services/logger';
import { CCXTExchange } from '../ccxtExchange';
import { DummyCentralizedExchange } from '../dummy/dummyCentralizedExchange';
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
    const { pairs } = config.getWatch();

    // Load real market data from Binance via CCXTExchange
    await this.realExchange.loadMarkets();

    // Build market data from real exchange, with optional fee overrides
    const marketData = new Map(pairs.map(({ symbol }) => [symbol, this.buildMarketData(symbol)]));

    // Get all tickers for initial price
    const tickers = await Promise.all(
      pairs.map(async ({ symbol }) => [symbol, await this.realExchange.fetchTicker(symbol)] as const),
    );

    // Initialize simulated exchange with real market constraints
    this.simulatedExchange = new DummyCentralizedExchange({
      name: 'dummy-cex',
      marketData,
      simulationBalance: this.exchangeConfig.simulationBalance,
      initialTicker: new Map(tickers),
      exchangeSynchInterval: this.exchangeConfig.exchangeSynchInterval,
      orderSynchInterval: this.exchangeConfig.orderSynchInterval,
    });

    info('exchange', '🔶 PAPER TRADING MODE - Using simulated orders with real market data');
    info('exchange', `Initial portfolio: ${JSON.stringify(this.exchangeConfig.simulationBalance)}`);
  }

  private buildMarketData(symbol: Symbol): MarketData {
    return {
      ...this.realExchange.getMarketData(symbol),
      ...(this.exchangeConfig.feeOverride && { fee: this.exchangeConfig.feeOverride }),
    };
  }

  /* -------------------------------------------------------------------------- */
  /*                    UNAUTHENTICATED OPERATIONS (via CCXTExchange)           */
  /* -------------------------------------------------------------------------- */

  public async fetchOHLCV(symbol: Symbol, params?: FetchOHLCVParams) {
    return this.realExchange.fetchOHLCV(symbol, params);
  }

  public async fetchTicker(symbol: Symbol) {
    return this.realExchange.fetchTicker(symbol);
  }

  public onNewCandle(symbol: Symbol, onNewCandle: (candle: Candle) => void) {
    return this.realExchange.onNewCandle(symbol, onNewCandle);
  }

  public getMarketData(symbol: Symbol): MarketData {
    return this.realExchange.getMarketData(symbol);
  }

  /* -------------------------------------------------------------------------- */
  /*                   AUTHENTICATED OPERATIONS (Simulated Locally)             */
  /* -------------------------------------------------------------------------- */

  public async fetchBalance(): Promise<Portfolio> {
    return this.simulatedExchange.fetchBalance();
  }

  public async createLimitOrder(
    symbol: Symbol,
    side: OrderSide,
    amount: number,
    price: number,
    onSettled?: OrderSettledCallback,
  ): Promise<OrderState> {
    return this.simulatedExchange.createLimitOrder(symbol, side, amount, price, onSettled);
  }

  public async createMarketOrder(symbol: Symbol, side: OrderSide, amount: number): Promise<OrderState> {
    return this.simulatedExchange.createMarketOrder(symbol, side, amount);
  }

  public async cancelOrder(symbol: Symbol, id: string): Promise<OrderState> {
    return this.simulatedExchange.cancelOrder(symbol, id);
  }

  public async fetchOrder(symbol: Symbol, id: string): Promise<OrderState> {
    return this.simulatedExchange.fetchOrder(symbol, id);
  }

  public async fetchMyTrades(symbol: Symbol, from?: EpochTimeStamp): Promise<Trade[]> {
    return this.simulatedExchange.fetchMyTrades(symbol, from);
  }

  /* -------------------------------------------------------------------------- */
  /*                          DUMMY EXCHANGE INTERFACE                          */
  /* -------------------------------------------------------------------------- */

  public async processOneMinuteCandle(symbol: Symbol, candle: Candle): Promise<void> {
    return this.simulatedExchange.processOneMinuteCandle(symbol, candle);
  }

  /* -------------------------------------------------------------------------- */
  /*                                IDENTIFICATION                              */
  /* -------------------------------------------------------------------------- */

  public getExchangeName(): string {
    return 'paper-binance';
  }
}
