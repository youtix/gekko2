export type RoundTrip = {
  id: number;
  entryAt: number;
  entryPrice: number;
  entryBalance: number;
  exitAt: number;
  exitPrice: number;
  exitBalance: number;
  duration: number;
  /**
   * Maximum Adverse Excursion (MAE) measured as the largest price drop
   * from the entry price observed before the roundtrip was closed.
   */
  maxAdverseExcursion: number;
  profit: number;
  pnl: number;
};
