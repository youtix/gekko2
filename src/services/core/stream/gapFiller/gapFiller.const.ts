import { Configuration } from '@models/types/configuration.types';

export const FILL_GAPS_MODE: Record<string, Configuration['watch']['fillGaps']> = {
  realtime: 'empty',
  backtest: 'no',
};
