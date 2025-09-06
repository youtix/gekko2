import { VolJSON } from '@services/learning/volume/vol.types';

export type ConvLayerOptions = {
  filters: number; // number of filters (output depth)
  sx: number; // filter width
  in_depth: number; // input depth
  in_sx: number; // input width
  in_sy: number; // input height
  sy?: number; // filter height (defaults to sx)
  stride?: number; // convolution stride
  pad?: number; // zero padding
  l1_decay_mul?: number; // L1 decay multiplier
  l2_decay_mul?: number; // L2 decay multiplier
  bias_pref?: number; // bias initialization preference
};

export type ParamGrad = {
  params: number[] | Float64Array;
  grads: number[] | Float64Array;
  l1_decay_mul: number;
  l2_decay_mul: number;
};

export type ConvLayerJSON = {
  sx: number;
  sy: number;
  stride: number;
  in_depth: number;
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'conv';
  l1_decay_mul: number;
  l2_decay_mul: number;
  pad: number;
  filters: VolJSON[];
  biases?: VolJSON;
};
