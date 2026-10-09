export const DEFAULT_TICKER = {
  bid: 100,
  ask: 101,
};

/**
 * The decimals the simulator books the currency of an order to: the cost of a BUY, its fee on top, and the proceeds of a SELL, its
 * fee taken off. Binance keeps every balance to 8 decimals. Booked whole, amount × price × (1 ± fee) had more digits than a double
 * holds beside a balance (up to 20 decimals for the documented market, whose amounts and prices have 8, at a fee of 0.0004), and the
 * currency balances could not be added up in decimal.
 */
export const COST_DECIMALS = 8;
