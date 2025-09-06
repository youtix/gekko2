export type SVMLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
};

export type SVMLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'svm';
  num_inputs: number;
};
