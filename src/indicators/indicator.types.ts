import { DEMA } from './movingAverages/dema/dema.indicator';
import { EMA } from './movingAverages/ema/ema.indicator';
import { SMA } from './movingAverages/sma/sma.indicator';
import { WMA } from './movingAverages/wma/wma.indicator';

export type IndicatorNames = keyof IndicatorRegistry;
export type IndicatorParamaters<T extends IndicatorNames> = IndicatorRegistry[T]['input'];
export type MovingAverageClasses = SMA | EMA | DEMA | WMA;
export type MovingAverageTypes = 'sma' | 'ema' | 'dema' | 'wma';
