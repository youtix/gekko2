export type BalanceDetail = {
  free: number;
  used: number;
  total: number;
};

export type Portfolio = {
  asset: BalanceDetail;
  currency: BalanceDetail;
};
