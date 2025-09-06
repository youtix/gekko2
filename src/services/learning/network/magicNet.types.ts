import { LayerDef } from '@models/layer.types';
import type { Trainer } from '../training/trainer';
import type { Net } from './net';

export type FoldIndices = {
  train_ix: number[];
  test_ix: number[];
};

export type TrainerMethod = 'sgd' | 'adagrad' | 'adadelta' | 'windowgrad';

export type TrainerDef = {
  method: TrainerMethod;
  learning_rate?: number;
  momentum?: number;
  batch_size?: number;
  l2_decay?: number;
  l1_decay?: number;
  ro?: number;
  eps?: number;
};

export type Candidate = {
  acc: number[];
  accv: number;
  layer_defs: LayerDef[];
  trainer_def: TrainerDef;
  net: Net;
  trainer: Trainer;
};

export type MagicNetOptions = {
  train_ratio: number;
  num_folds: number;
  num_candidates: number;
  num_epochs: number;
  ensemble_size: number;
  batch_size_min: number;
  batch_size_max: number;
  l2_decay_min: number;
  l2_decay_max: number;
  learning_rate_min: number;
  learning_rate_max: number;
  momentum_min: number;
  momentum_max: number;
  neurons_min: number;
  neurons_max: number;
};

export type MagicNetJSON = {
  nets: ReturnType<Net['toJSON']>[];
};
