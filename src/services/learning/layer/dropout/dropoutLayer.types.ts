export type DropoutLayerOptions = {
  in_sx: number;
  in_sy: number;
  in_depth: number;
  drop_prob?: number;
};

export type DropoutJSON = {
  out_depth: number;
  out_sx: number;
  out_sy: number;
  layer_type: 'dropout';
  drop_prob: number;
};
