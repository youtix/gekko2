import { zeros } from '../learning.utils';
// implements an L2 regression cost layer,
// so penalizes \sum_i(||x_i - y_i||^2), where x is its input
// and y is the user-provided array of "correct" values.
export class RegressionLayer {
  num_inputs;
  out_depth;
  out_sx;
  out_sy;
  layer_type;
  in_act;
  out_act;

  constructor(opt = {}) {
    // computed
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'regression';
  }

  forward(V, is_training) {
    this.in_act = V;
    this.out_act = V;
    return V; // identity function
  }

  // y isa list here of size num_inputs
  backward(y) {
    // compute and accumulate gradient wrt weights and bias of this layer
    const x = this.in_act;
    x.dw = zeros(x.w.length); // zero out the gradient of input Vol
    let loss = 0.0;
    if (y instanceof Array || y instanceof Float64Array) {
      for (let i = 0; i < this.out_depth; i++) {
        const dy = x.w[i] - y[i];
        x.dw[i] = dy;
        loss += 2 * dy * dy;
      }
    } else {
      // assume it is a struct with entries .dim and .val
      // and we pass gradient only along dimension dim to be equal to val
      const i = y.dim;
      const yi = y.val;
      const dy = x.w[i] - yi;
      x.dw[i] = dy;
      loss += 2 * dy * dy;
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
