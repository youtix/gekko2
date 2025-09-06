export type PoolLayerOptions = {
  sx: number; // filter size in x
  in_depth: number;
  in_sx: number;
  in_sy: number;
  sy?: number; // filter size in y (defaults to sx)
  stride?: number;
  pad?: number; // zero padding
};

export type PoolLayerJSON = {
  sx: number;
  sy: number;
  stride: number;
  in_depth: number;
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'pool';
  pad: number;
};
