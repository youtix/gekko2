export type Trade = {
  id: string; // Trade Id
  amount: number;
  timestamp: EpochTimeStamp;
  price: number;
  fee: {
    rate: number;
  };
};
