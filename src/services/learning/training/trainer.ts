import type { ParamGrad } from '../layer/conv/convLayer.types';
import { zeros } from '../learning.utils';
import type { Net } from '../network/net';
import type { Vol } from '../volume/vol';
import type { AccumulatorList, TrainStats, TrainerOptions } from './trainer.types';

/**
 * Trainer performs parameter updates on a `Net` using a chosen optimizer.
 *
 * It keeps lightweight state needed by different update rules (SGD, AdaGrad,
 * AdaDelta, WindowGrad) and applies L1/L2 regularization. The trainer is
 * stateless with respect to data and expects callers to invoke `train` once
 * per example; effective mini-batching is achieved by delaying updates until
 * `batch_size` calls have accumulated.
 */
export class Trainer {
  /** Network to optimize. */
  net: Net;
  /** Base learning rate used by the optimizer. */
  learning_rate: number;
  /** L1 regularization strength (weight decay). */
  l1_decay: number;
  /** L2 regularization strength (weight decay). */
  l2_decay: number;
  /** Number of examples per parameter update (accumulated steps). */
  batch_size: number;
  /** Optimization algorithm to use. */
  method: 'sgd' | 'adagrad' | 'adadelta' | 'windowgrad';
  /** Momentum factor for SGD variants. */
  momentum: number;
  /** EMA decay factor (rho) used by AdaDelta/WindowGrad. */
  ro: number;
  /** Numerical stability epsilon for adaptive methods. */
  eps: number;
  /** Global step counter across `train` calls. */
  k: number;
  /** Gradient/history accumulators per parameter group (optimizer state). */
  gsum: AccumulatorList;
  /** Update accumulators for AdaDelta; empty for other methods. */
  xsum: AccumulatorList;

  constructor(net: Net, opt: TrainerOptions) {
    this.net = net;
    this.learning_rate = opt.learning_rate ?? 0.01;
    this.l1_decay = opt.l1_decay ?? 0.0;
    this.l2_decay = opt.l2_decay ?? 0.0;
    this.batch_size = opt.batch_size ?? 1;
    this.method = opt.method ?? 'sgd'; // sgd/adagrad/adadelta/windowgrad
    this.momentum = opt.momentum ?? 0.9;
    this.ro = opt.ro ?? 0.95; // used in adadelta
    this.eps = opt.eps ?? 1e-6; // used in adadelta
    this.k = 0; // iteration counter
    this.gsum = []; // last iteration gradients (used for momentum calculations)
    this.xsum = []; // used in adadelta
  }

  train(x: Vol, y: Parameters<Net['backward']>[0]): TrainStats {
    // Forward
    let start = Date.now();
    this.net.forward(x, true); // also set the flag that lets the net know we're just training
    let end = Date.now();
    const fwd_time = end - start;

    // Backward
    start = Date.now();
    const cost_loss = this.net.backward(y);
    let l2_decay_loss = 0.0;
    let l1_decay_loss = 0.0;
    end = Date.now();
    const bwd_time = end - start;

    this.k++;
    if (this.k % this.batch_size === 0) {
      const pglist: ParamGrad[] = this.net.getParamsAndGrads();
      // initialize lists for accumulators. Will only be done once on first iteration
      if (this.gsum.length === 0 && (this.method !== 'sgd' || this.momentum > 0.0)) {
        // only vanilla sgd doesnt need either lists
        // momentum needs gsum
        // adagrad needs gsum
        // adadelta needs gsum and xsum
        for (let i = 0; i < pglist.length; i++) {
          this.gsum.push(zeros(pglist[i].params.length));
          if (this.method === 'adadelta') {
            this.xsum.push(zeros(pglist[i].params.length));
          } else {
            this.xsum.push([]); // conserve memory
          }
        }
      }
      // perform an update for all sets of weights
      for (let i = 0; i < pglist.length; i++) {
        const pg = pglist[i]; // param, gradient, other options in future (custom learning rate etc)
        const p = pg.params;
        const g = pg.grads;
        // learning rate for some parameters.
        const l2_decay_mul = typeof pg.l2_decay_mul !== 'undefined' ? pg.l2_decay_mul : 1.0;
        const l1_decay_mul = typeof pg.l1_decay_mul !== 'undefined' ? pg.l1_decay_mul : 1.0;
        const l2_decay = this.l2_decay * l2_decay_mul;
        const l1_decay = this.l1_decay * l1_decay_mul;
        const plen = p.length;
        for (let j = 0; j < plen; j++) {
          l2_decay_loss += (l2_decay * p[j] * p[j]) / 2; // accumulate weight decay loss
          l1_decay_loss += l1_decay * Math.abs(p[j]);
          const l1grad = l1_decay * (p[j] > 0 ? 1 : -1);
          const l2grad = l2_decay * p[j];
          const gij = (l2grad + l1grad + g[j]) / this.batch_size; // raw batch gradient
          const gsumi = this.gsum[i];
          const xsumi = this.xsum[i];
          if (this.method === 'adagrad') {
            // adagrad update
            gsumi[j] = gsumi[j] + gij * gij;
            const dx = (-this.learning_rate / Math.sqrt(gsumi[j] + this.eps)) * gij;
            p[j] += dx;
          } else if (this.method === 'windowgrad') {
            // this is adagrad but with a moving window weighted average
            // so the gradient is not accumulated over the entire history of the run.
            // it's also referred to as Idea #1 in Zeiler paper on Adadelta. Seems reasonable to me!
            gsumi[j] = this.ro * gsumi[j] + (1 - this.ro) * gij * gij;
            const dx = (-this.learning_rate / Math.sqrt(gsumi[j] + this.eps)) * gij; // eps added for better conditioning
            p[j] += dx;
          } else if (this.method === 'adadelta') {
            // assume adadelta if not sgd or adagrad
            gsumi[j] = this.ro * gsumi[j] + (1 - this.ro) * gij * gij;
            const dx = -Math.sqrt((xsumi[j] + this.eps) / (gsumi[j] + this.eps)) * gij;
            xsumi[j] = this.ro * xsumi[j] + (1 - this.ro) * dx * dx; // yes, xsum lags behind gsum by 1.
            p[j] += dx;
          } else {
            // assume SGD
            if (this.momentum > 0.0) {
              // momentum update
              const dx = this.momentum * gsumi[j] - this.learning_rate * gij; // step
              gsumi[j] = dx; // back this up for next iteration of momentum
              p[j] += dx; // apply corrected gradient
            } else {
              // vanilla sgd
              p[j] += -this.learning_rate * gij;
            }
          }
          g[j] = 0.0; // zero out gradient so that we can begin accumulating anew
        }
      }
    }
    // appending softmax_loss for backwards compatibility, but from now on we will always use cost_loss
    // in future, TODO: have to completely redo the way loss is done around the network as currently
    // loss is a bit of a hack. Ideally, user should specify arbitrary number of loss functions on any layer
    // and it should all be computed correctly and automatically.
    return {
      fwd_time: fwd_time,
      bwd_time: bwd_time,
      l2_decay_loss: l2_decay_loss,
      l1_decay_loss: l1_decay_loss,
      cost_loss: cost_loss,
      softmax_loss: cost_loss,
      loss: cost_loss + l1_decay_loss + l2_decay_loss,
    } as TrainStats;
  }
}
