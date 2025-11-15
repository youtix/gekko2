export type OrderState = {
  id: string;
  status: 'open' | 'closed' | 'canceled';
  timestamp: EpochTimeStamp;
  filled?: number;
  remaining?: number;
  price?: number;
};

export type OrderType = 'MARKET' | 'STICKY' | 'LIMIT';
export type OrderSide = 'SELL' | 'BUY';
