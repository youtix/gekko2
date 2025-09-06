import { zeros } from '../learning.utils';

// An inefficient dropout layer
// Note this is not most efficient implementation since the layer before
// computed all these activations and now we're just going to drop them :(
// same goes for backward pass. Also, if we wanted to be efficient at test time
// we could equivalently be clever and upscale during train and copy pointers during test
// TODO: make more efficient.
export class DropoutLayer {
  out_sx;
  out_sy;
  out_depth;
  layer_type;
  drop_prob;
  dropped;

  constructor(opt = {}) {
    this.out_sx = opt.in_sx;
    this.out_sy = opt.in_sy;
    this.out_depth = opt.in_depth;
    this.layer_type = 'dropout';
    this.drop_prob = typeof opt.drop_prob !== 'undefined' ? opt.drop_prob : 0.5;
    this.dropped = zeros(this.out_sx * this.out_sy * this.out_depth);
  }

  forward(V, is_training) {
    this.in_act = V;
    if (typeof is_training === 'undefined') {
      is_training = false;
    } // default is prediction mode
    const V2 = V.clone();
    const N = V.w.length;
    if (is_training) {
      // do dropout
      for (let i = 0; i < N; i++) {
        if (Math.random() < this.drop_prob) {
          V2.w[i] = 0;
          this.dropped[i] = true;
        } // drop!
        else {
          this.dropped[i] = false;
        }
      }
    } else {
      // scale the activations during prediction
      for (let i = 0; i < N; i++) {
        V2.w[i] *= this.drop_prob;
      }
    }
    this.out_act = V2;
    return this.out_act; // dummy identity function for now
  }

  backward() {
    const V = this.in_act; // we need to set dw of this
    const chain_grad = this.out_act;
    const N = V.w.length;
    V.dw = zeros(N); // zero out gradient wrt data
    for (let i = 0; i < N; i++) {
      if (!this.dropped[i]) {
        V.dw[i] = chain_grad.dw[i]; // copy over the gradient
      }
    }
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
      drop_prob: this.drop_prob,
    };
  }

  fromJSON(json) {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.drop_prob = json.drop_prob;
  }
}
