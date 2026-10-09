export type Trade = {
  /** Trade Id */
  id: string;
  amount: number;
  timestamp: EpochTimeStamp;
  price: number;
  fee: {
    /** Rate in % (0.1 for 0.1 %), undefined when unknown. Never 0 by default: 0 is a trade without fees */
    rate?: number;
    /** Informative: what the fee cost, in its currency, as the exchange reports it */
    cost?: number;
    /** Informative: the currency the fee was paid in, as the exchange names it */
    currency?: string;
  };
};
