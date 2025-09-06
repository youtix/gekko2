import { zeros } from './learning.utils';

export class Trainer {
  net;
  learning_rate;
  l1_decay;
  l2_decay;
  batch_size;
  method;
  momentum;
  ro;
  eps;
  k;
  gsum;
  xsum;

  constructor(net, opt = {}) {
    this.net = net;
    this.learning_rate = typeof opt.learning_rate !== 'undefined' ? opt.learning_rate : 0.01;
    this.l1_decay = typeof opt.l1_decay !== 'undefined' ? opt.l1_decay : 0.0;
    this.l2_decay = typeof opt.l2_decay !== 'undefined' ? opt.l2_decay : 0.0;
    this.batch_size = typeof opt.batch_size !== 'undefined' ? opt.batch_size : 1;
    this.method = typeof opt.method !== 'undefined' ? opt.method : 'sgd'; // sgd/adagrad/adadelta/windowgrad
    this.momentum = typeof opt.momentum !== 'undefined' ? opt.momentum : 0.9;
    this.ro = typeof opt.ro !== 'undefined' ? opt.ro : 0.95; // used in adadelta
    this.eps = typeof opt.eps !== 'undefined' ? opt.eps : 1e-6; // used in adadelta
    this.k = 0; // iteration counter
    this.gsum = []; // last iteration gradients (used for momentum calculations)
    this.xsum = []; // used in adadelta
  }

  train(x, y) {
    let start = new Date().getTime();
    this.net.forward(x, true); // also set the flag that lets the net know we're just training
    let end = new Date().getTime();
    const fwd_time = end - start;
    start = new Date().getTime();
    const cost_loss = this.net.backward(y);
    let l2_decay_loss = 0.0;
    let l1_decay_loss = 0.0;
    end = new Date().getTime();
    const bwd_time = end - start;
    this.k++;
    if (this.k % this.batch_size === 0) {
      const pglist = this.net.getParamsAndGrads();
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
    };
  }
}
