import { UUID } from 'node:crypto';
import { Candle } from './candle.types';
import { OrderSide, OrderType } from './order.types';
import { Portfolio } from './portfolio.types';
import { TradingPair } from './utility.types';

export type CandleBucket = Map<TradingPair, Candle>;

type OrderEvent = {
  /** Order Id */
  id: UUID;
  /** Trading Pair */
  symbol: TradingPair;
  /** Order side (SELL | BUY)*/
  side: OrderSide;
  /** Order type ('MARKET' | 'STICKY' | 'LIMIT')*/
  type: OrderType;
  /** Order amount */
  amount: number;
  /** Order price in currency */
  price?: number;
};

export type ExchangeEvent = {
  /** Current portfolio value */
  portfolio: Portfolio;
  /** Current price of the asset in currencey */
  price: number;
};

export type OrderInitiatedEvent = {
  order: OrderEvent & {
    /** Order Creation date */
    orderCreationDate: EpochTimeStamp;
  };
  exchange: ExchangeEvent;
};

export type OrderCanceledEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order Cancelation date */
    orderCancelationDate: EpochTimeStamp;
    /** Order filled amount */
    filled: number;
    /** Order remaining amount */
    remaining: number;
  };
};

export type OrderErroredEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order error reason */
    reason: string;
    /** Order error date */
    orderErrorDate: EpochTimeStamp;
    /**
     * What the order executed before its error, as far as the exchange reported it (see Order.getFilledAmount): an error may follow
     * fills, those of a STICKY order whose relaunch failed, or of an order whose poll or cancelation failed for good. 0 when none was
     * reported, which does not prove that nothing executed: an order whose outcome is unknown may have. Left out by an emitter that
     * does not know it.
     */
    filled?: number;
  };
};
/** Can return NaN values in price, amount,effectivePrice, fee, feePercent */
export type OrderCompletedEvent = OrderInitiatedEvent & {
  order: OrderEvent & {
    /** Order Execution date */
    orderExecutionDate: EpochTimeStamp;
    effectivePrice: number;
    /** Order fee */
    fee: number;
    /** Order fee percentage */
    feePercent?: number;
  };
};

export type RoundTrip = {
  id: number;
  entryAt: number;
  entryPrice: number;
  entryEquity: number;
  exitAt: number;
  exitPrice: number;
  exitEquity: number;
  duration: number;
  maxAdverseExcursion: number;
  profit: number;
  pnl: number;
};

export type Report = {
  /** Unique identifier for the report type */
  id: 'TRADING REPORT' | 'PORTFOLIO PROFIT REPORT';
  /** Why the run stopped before its end, when it did: the report then covers a partial period */
  interruption?: string;
  /** Performance relative to the benchmark market return (Excess Return) */
  alpha: number;
  /** Downside deviation of the returns: root mean square of the negative ones, positive ones counting as 0 (Sortino ratio) */
  downsideDeviation: number;
  /** Timestamp indicating when the reporting period ended */
  periodEndAt: EpochTimeStamp;
  /** Timestamp indicating when the reporting period started */
  periodStartAt: EpochTimeStamp;
  /** Percentage of time the portfolio was exposed to market risk */
  exposurePct: number;
  /** Overall market performance during the same period (%) */
  marketReturnPct: number;
  /** Total net profit expressed in currency units */
  netProfit: number;
  /** Total return on investment for the entire period (%) */
  totalReturnPct: number;
  /** Annualized return on investment (%) */
  annualizedReturnPct: number;
  /** Sharpe Ratio: measure of risk-adjusted return using total volatility */
  sharpeRatio: number;
  /** Sortino Ratio: measure of risk-adjusted return focus on downside deviation */
  sortinoRatio: number;
  /** Volatility of the returns: of the round trips for the RoundTripAnalyzer, of the timeframe candles for the PortfolioAnalyzer (%) */
  volatility: number;
  /** Asset price at the beginning of the period */
  startPrice: number;
  /** Asset price at the end of the period */
  endPrice: number;
  /** Human-readable string representing the elapsed time (e.g., "3 months, 2 days") */
  formattedDuration: string;
  /** Net profit normalized to a one-year timeframe (currency units) */
  annualizedNetProfit: number;
};

export interface EquitySnapshot {
  /** Timestamp of the snapshot */
  date: EpochTimeStamp;
  /** Total portfolio value in Numéraire (e.g., USDT) */
  totalValue: number;
}
