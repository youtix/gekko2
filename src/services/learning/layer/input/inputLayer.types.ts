export type InputLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
  out_sx: number;
  out_sy: number;
  out_depth: number;
};

export type InputLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'input';
};
