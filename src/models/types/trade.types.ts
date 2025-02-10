export type Trade = {
  order: string; // order ID
  amount: number;
  timestamp: EpochTimeStamp;
  price: number;
  fee: {
    rate: number;
  };
};
