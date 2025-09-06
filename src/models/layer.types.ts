/** A broad layer definition used to build networks */
export type LayerType =
  | 'input'
  | 'fc'
  | 'lrn'
  | 'dropout'
  | 'softmax'
  | 'regression'
  | 'conv'
  | 'pool'
  | 'relu'
  | 'sigmoid'
  | 'tanh'
  | 'maxout'
  | 'quadtransform'
  | 'svm';

export type ActivationType = 'relu' | 'sigmoid' | 'tanh' | 'maxout';

export type LayerDef = {
  type: LayerType;
  in_sx?: number;
  in_sy?: number;
  in_depth?: number;
  out_sx?: number;
  out_sy?: number;
  out_depth?: number;
  filters?: number;
  sx?: number;
  sy?: number;
  stride?: number;
  pad?: number;
  l1_decay_mul?: number;
  l2_decay_mul?: number;
  bias_pref?: number;
  activation?: ActivationType;
  group_size?: number;
  drop_prob?: number;
  tensor?: boolean;
  num_classes?: number;
  num_neurons?: number;
  k?: number;
  n?: number;
  alpha?: number;
  beta?: number;
};
