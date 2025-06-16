export type Direction = 'short' | 'long';
export type StrategyNames = keyof StrategyRegistry;
export type StrategyParamaters<T extends StrategyNames> = StrategyRegistry[T];
