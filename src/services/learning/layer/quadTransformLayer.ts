import { zeros } from '../learning.utils';
import { Vol } from '../volume/vol';

// transforms x-> [x, x_i*x_j forall i,j]
// so the fully connected layer afters will essentially be doing tensor multiplies
export class QuadTransformLayer {
  out_sx;
  out_sy;
  out_depth;
  layer_type;
  in_act;
  out_act;

  constructor(opt = {}) {
    // computed
    this.out_sx = opt.in_sx;
    this.out_sy = opt.in_sy;
    // linear terms, and then quadratic terms, of which there are 1/2*n*(n+1),
    // (offdiagonals and the diagonal total) and arithmetic series.
    // Actually never mind, lets not be fancy here yet and just include
    // terms x_ix_j and x_jx_i twice. Half as efficient but much less
    // headache.
    this.out_depth = opt.in_depth + opt.in_depth * opt.in_depth;
    this.layer_type = 'quadtransform';
  }

  forward(V, is_training) {
    this.in_act = V;
    const N = this.out_depth;
    const Ni = V.depth;
    const V2 = new Vol(this.out_sx, this.out_sy, this.out_depth, 0.0);
    for (let x = 0; x < V.sx; x++) {
      for (let y = 0; y < V.sy; y++) {
        for (let i = 0; i < N; i++) {
          if (i < Ni) {
            V2.set(x, y, i, V.get(x, y, i)); // copy these over (linear terms)
          } else {
            const i0 = Math.floor((i - Ni) / Ni);
            const i1 = i - Ni - i0 * Ni;
            V2.set(x, y, i, V.get(x, y, i0) * V.get(x, y, i1)); // quadratic
          }
        }
      }
    }
    this.out_act = V2;
    return this.out_act; // dummy identity function for now
  }
  backward() {
    const V = this.in_act;
    V.dw = zeros(V.w.length); // zero out gradient wrt data
    const V2 = this.out_act;
    const N = this.out_depth;
    const Ni = V.depth;
    for (let x = 0; x < V.sx; x++) {
      for (let y = 0; y < V.sy; y++) {
        for (let i = 0; i < N; i++) {
          const chain_grad = V2.get_grad(x, y, i);
          if (i < Ni) {
            V.add_grad(x, y, i, chain_grad);
          } else {
            const i0 = Math.floor((i - Ni) / Ni);
            const i1 = i - Ni - i0 * Ni;
            V.add_grad(x, y, i0, V.get(x, y, i1) * chain_grad);
            V.add_grad(x, y, i1, V.get(x, y, i0) * chain_grad);
          }
        }
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
    };
  }
  fromJSON(json) {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
