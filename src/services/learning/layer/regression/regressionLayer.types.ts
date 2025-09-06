export type RegressionLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
};

export type RegressionLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'regression';
  num_inputs: number;
};
