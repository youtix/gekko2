import { Candle } from '@models/candle.types';
import { InputSources } from '@models/inputSources.types';
import { INPUT_SOURCES } from './indicator.const';

/**
 * The price an indicator reads from each candle, named by its `src` parameter, or the close when it names none: the indicators built
 * on others feed them made-up candles that hold only a close. Every indicator with a `src` reads it through here, so that they agree
 * on it: DEMA, TEMA, WMA and Wilder's smoothing used to ignore it.
 */
export const getInputSource = (src: InputSources = 'close'): ((candle: Candle) => number) => INPUT_SOURCES[src];
