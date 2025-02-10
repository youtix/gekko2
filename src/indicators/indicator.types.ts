export type IndicatorNames = keyof IndicatorRegistry;
export type IndicatorParamaters<T extends IndicatorNames> = IndicatorRegistry[T]['input'];
