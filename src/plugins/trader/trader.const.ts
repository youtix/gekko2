import { MarketOrder } from '@services/core/order/market/marketOrder';
import { StickyOrder } from '@services/core/order/sticky/stickyOrder';

export const SYNCHRONIZATION_INTERVAL = 1000 * 60 * 10; // 10 minutes
export const ORDER_FACTORY = {
  MARKET: MarketOrder,
  STICKY: StickyOrder,
} as const;

export const DEFAULT_FEE_BUFFER = 0.05; // 5%
