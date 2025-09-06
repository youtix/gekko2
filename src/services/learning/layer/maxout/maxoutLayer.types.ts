export type MaxoutLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
  group_size?: number;
};

export type MaxoutLayerJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'maxout';
  group_size: number;
};

