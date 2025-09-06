export type SoftmaxLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
};

export type SoftmaxLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'softmax';
  num_inputs: number;
};

