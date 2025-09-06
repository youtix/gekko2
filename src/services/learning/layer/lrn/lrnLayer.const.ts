import { LRNLayerOptions } from './lrnLayer.types';

export const DEFAULT_LRN_LAYER_OPTIONS: LRNLayerOptions = {
  in_sx: 1,
  in_sy: 1,
  in_depth: 1,
  k: 2.0,
  n: 5,
  alpha: 1e-4,
  beta: 0.75,
};
