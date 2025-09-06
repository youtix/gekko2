import { zeros } from '../learning.utils';
import { Vol } from '../volume/vol';

// Layers that implement a loss. Currently these are the layers that
// can initiate a backward() pass. In future we probably want a more
// flexible system that can accomodate multiple losses to do multi-task
// learning, and stuff like that. But for now, one of the layers in this
// file must be the final layer in a Net.
// This is a classifier, with N discrete classes from 0 to N-1
// it gets a stream of N incoming numbers and computes the softmax
// function (exponentiate and normalize to sum to 1 as probabilities should)
export class SoftmaxLayer {
  num_inputs;
  out_depth;
  out_sx;
  out_sy;
  layer_type;
  in_act;
  out_act;
  es;

  constructor(opt = {}) {
    // computed
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'softmax';
  }

  forward(V, is_training) {
    this.in_act = V;
    const A = new Vol(1, 1, this.out_depth, 0.0);
    // compute max activation
    const as = V.w;
    let amax = V.w[0];
    for (let i = 1; i < this.out_depth; i++) {
      if (as[i] > amax) amax = as[i];
    }
    // compute exponentials (carefully to not blow up)
    const es = zeros(this.out_depth);
    let esum = 0.0;
    for (let i = 0; i < this.out_depth; i++) {
      const e = Math.exp(as[i] - amax);
      esum += e;
      es[i] = e;
    }
    // normalize and output to sum to one
    for (let i = 0; i < this.out_depth; i++) {
      es[i] /= esum;
      A.w[i] = es[i];
    }
    this.es = es; // save these for backprop
    this.out_act = A;
    return this.out_act;
  }
  backward(y) {
    // compute and accumulate gradient wrt weights and bias of this layer
    const x = this.in_act;
    x.dw = zeros(x.w.length); // zero out the gradient of input Vol
    for (let i = 0; i < this.out_depth; i++) {
      const indicator = i === y ? 1.0 : 0.0;
      const mul = -(indicator - this.es[i]);
      x.dw[i] = mul;
    }
    // loss is the class negative log likelihood
    return -Math.log(this.es[y]);
  }
  getParamsAndGrads() {
    return [];
  }
  toJSON() {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      num_inputs: this.num_inputs,
    };
  }
  fromJSON(json) {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.num_inputs = json.num_inputs;
  }
}
