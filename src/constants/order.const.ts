export const DEFAULT_FEE_BUFFER = 0.05; // 5%
/** The sides of an order, the one list of them: OrderSide derives from it, and the StrategyManager refuses an order of any other side */
export const ORDER_SIDES = ['BUY', 'SELL'] as const;
/**
 * The types of an order, the one list of them: OrderType derives from it, the Trader places each with its own order class
 * (ORDER_FACTORY), and the StrategyManager refuses an order of any other type
 */
export const ORDER_TYPES = ['MARKET', 'STICKY', 'LIMIT'] as const;
export const EMPTY_ORDER_SUMMARY = {
  amount: NaN,
  price: NaN,
  feePercent: NaN,
  orderExecutionDate: NaN,
} as const;
