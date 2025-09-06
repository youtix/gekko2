import { zeros } from '../learning.utils';

export class SVMLayer {
  num_inputs;
  out_depth;
  out_sx;
  out_sy;
  layer_type;
  in_act;
  out_act;

  constructor(opt = {}) {
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'svm';
  }
  forward(V, is_training) {
    this.in_act = V;
    this.out_act = V; // nothing to do, output raw scores
    return V;
  }
  backward(y) {
    // compute and accumulate gradient wrt weights and bias of this layer
    const x = this.in_act;
    x.dw = zeros(x.w.length); // zero out the gradient of input Vol
    const yscore = x.w[y]; // score of ground truth
    const margin = 1.0;
    let loss = 0.0;
    for (let i = 0; i < this.out_depth; i++) {
      if (-yscore + x.w[i] + margin > 0) {
        // violating example, apply loss
        // I love hinge loss, by the way. Truly.
        // Seriously, compare this SVM code with Softmax forward AND backprop code above
        // it's clear which one is superior, not only in code, simplicity
        // and beauty, but also in practice.
        x.dw[i] += 1;
        x.dw[y] -= 1;
        loss += -yscore + x.w[i] + margin;
      }
    }
    return loss;
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
