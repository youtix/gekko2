export type Trade = {
  /** Trade Id */
  id: string;
  amount: number;
  timestamp: EpochTimeStamp;
  price: number;
  fee: {
    /** Rate in % */
    rate: number;
  };
};
