export type OnTriggerFn = (price: number) => void;

export type TrailingStopArg = {
  trail: number;
  initialPrice: number;
  onTrigger: OnTriggerFn;
};
