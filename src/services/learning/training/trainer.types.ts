import type { TrainerMethod } from '../network/magicNet.types';
import type { Net } from '../network/net';

// Light aliases to keep Trainer readable
export type Accumulator = number[] | Float64Array;
export type AccumulatorList = Accumulator[];

// Target type accepted by Net.backward
export type TrainerTarget = Parameters<Net['backward']>[0];

// Options accepted by Trainer (all optional; defaults applied in constructor)
export type TrainerOptions = {
  method?: TrainerMethod;
  learning_rate?: number;
  momentum?: number;
  batch_size?: number;
  l2_decay?: number;
  l1_decay?: number;
  ro?: number;
  eps?: number;
};

// Stats returned by a single training step
export type TrainStats = {
  fwd_time: number;
  bwd_time: number;
  l2_decay_loss: number;
  l1_decay_loss: number;
  cost_loss: number;
  softmax_loss: number;
  loss: number;
};
