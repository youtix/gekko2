import { LayerInstance } from '@services/learning/learning.types';
import { warning } from '@services/logger';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import type { ParamGrad } from '../conv/convLayer.types';
import { DEFAULT_LRN_LAYER_OPTIONS } from './lrnLayer.const';
import { LRNLayerJSON, LRNLayerOptions } from './lrnLayer.types';

/**
 * A bit experimental layer for now. I think it works but I'm not 100%
 * the gradient check is a bit funky. I'll look into this a bit later.
 * Local Response Normalization (LRN) in window, along depths of volumes
 */
export class LRNLayer implements LayerInstance {
  k: number;
  n: number;
  alpha: number;
  beta: number;
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'lrn';
  in_act!: Vol;
  S_cache_!: Vol;
  out_act!: Vol;

  constructor(opt: LRNLayerOptions = DEFAULT_LRN_LAYER_OPTIONS) {
    // required
    this.k = opt.k;
    this.n = opt.n;
    this.alpha = opt.alpha;
    this.beta = opt.beta;

    // computed
    this.out_sx = opt.in_sx;
    this.out_sy = opt.in_sy;
    this.out_depth = opt.in_depth;
    this.layer_type = 'lrn';

    // checks
    if (this.n % 2 === 0) warning('learning', 'n should be odd for LRN layer');
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const A = V.cloneAndZero();
    this.S_cache_ = V.cloneAndZero();
    const n2 = Math.floor(this.n / 2);
    for (let x = 0; x < V.sx; x++) {
      for (let y = 0; y < V.sy; y++) {
        for (let i = 0; i < V.depth; i++) {
          const ai = V.get(x, y, i);
          // normalize in a window of size n
          let den = 0.0;
          for (let j = Math.max(0, i - n2); j <= Math.min(i + n2, V.depth - 1); j++) {
            const aa = V.get(x, y, j);
            den += aa * aa;
          }
          den *= this.alpha / this.n;
          den += this.k;
          this.S_cache_.set(x, y, i, den); // will be useful for backprop
          den = Math.pow(den, this.beta);
          A.set(x, y, i, ai / den);
        }
      }
    }
    this.out_act = A;
    return this.out_act; // dummy identity function for now
  }
  backward(): void {
    // evaluate gradient wrt data
    const V = this.in_act; // we need to set dw of this
    V.dw = zeros(V.w.length); // zero out gradient wrt data
    const n2 = Math.floor(this.n / 2);
    for (let x = 0; x < V.sx; x++) {
      for (let y = 0; y < V.sy; y++) {
        for (let i = 0; i < V.depth; i++) {
          const chain_grad = this.out_act.get_grad(x, y, i);
          const S = this.S_cache_.get(x, y, i);
          const SB = Math.pow(S, this.beta);
          const SB2 = SB * SB;
          // normalize in a window of size n
          for (let j = Math.max(0, i - n2); j <= Math.min(i + n2, V.depth - 1); j++) {
            const aj = V.get(x, y, j);
            let g = ((-aj * this.beta * Math.pow(S, this.beta - 1) * this.alpha) / this.n) * 2 * aj;
            if (j === i) g += SB;
            g /= SB2;
            g *= chain_grad;
            V.add_grad(x, y, j, g);
          }
        }
      }
    }
  }
  getParamsAndGrads(): ParamGrad[] | [] {
    return [];
  }
  toJSON(): LRNLayerJSON {
    return {
      k: this.k,
      n: this.n,
      alpha: this.alpha, // normalize by size
      beta: this.beta,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      out_depth: this.out_depth,
      layer_type: this.layer_type,
    };
  }
  fromJSON(json: LRNLayerJSON): void {
    this.k = json.k;
    this.n = json.n;
    this.alpha = json.alpha; // normalize by size
    this.beta = json.beta;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.out_depth = json.out_depth;
    this.layer_type = json.layer_type;
  }
}
