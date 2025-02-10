export type Trigger = {
  type: 'trailingStop';
  trailValue?: number;
  trailPercentage: number;
};
export type Advice = {
  id: string;
  recommendation: 'short' | 'long';
  date: EpochTimeStamp;
  trigger?: Trigger;
};
