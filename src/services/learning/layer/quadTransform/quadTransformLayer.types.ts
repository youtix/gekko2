export type QuadTransformLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
};

export type QuadTransformLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'quadtransform';
};
