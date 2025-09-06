export type TanhLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
};

export type TanhLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'tanh';
};
