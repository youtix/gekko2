export type OrderStatus =
  | 'canceled' // Order was succesfully canceled
  | 'error'
  | 'filled' // Order is completely filled
  | 'initializing' // Not created
  | 'open' // Order is open on the exchange
  | 'rejected'; // Order was rejected by the exchange

export type Transaction = { id: string; timestamp: EpochTimeStamp; filled?: number };
