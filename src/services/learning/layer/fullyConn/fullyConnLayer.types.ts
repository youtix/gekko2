import { VolJSON } from '../../volume/vol.types';

export type FullyConnLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
  filters: number; // number of neurons (output depth)
  num_neurons?: number; // alias for filters
  l1_decay_mul?: number;
  l2_decay_mul?: number;
  bias_pref?: number;
};

export type FullyConnLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'fc';
  num_inputs: number;
  l1_decay_mul: number;
  l2_decay_mul: number;
  filters: VolJSON[];
  biases?: VolJSON;
};
