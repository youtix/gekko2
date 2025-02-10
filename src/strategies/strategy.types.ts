import { Trigger } from '../models/types/advice.types';

export type Direction = 'short' | 'long';
type StructuredAdvice = {
  direction: Direction;
  trigger: Trigger;
};
export type RecommendedAdvice = Direction | StructuredAdvice;
export type StrategyNames = keyof StrategyRegistry;
export type StrategyParamaters<T extends StrategyNames> = StrategyRegistry[T];
