export type LRNLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
  k: number;
  n: number; // should be odd
  alpha: number;
  beta: number;
};

export type LRNLayerJSON = {
  k: number;
  n: number;
  alpha: number;
  beta: number;
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'lrn';
};
