/** Default retryOnError: the retries of a failed order before GridBot gives up on it */
export const DEFAULT_RETRY_LIMIT = 3;

/** Default amount precision when not specified by exchange */
export const DEFAULT_AMOUNT_PRECISION = 8;

/**
 * Decimals of the prices on a market that states no price tick (precision.price), as DEFAULT_AMOUNT_PRECISION for amounts: the strategy
 * warns of it when the grid starts
 */
export const DEFAULT_PRICE_PRECISION = 8;

export const EMPTY_BALANCE = { free: 0, used: 0, total: 0 };
