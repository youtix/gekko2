import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_TANH_LAYER_OPTIONS } from './tanhLayer.const';
import { TanhLayerJSON, TanhLayerOptions } from './tanhLayer.types';

/** Implements Tanh nnonlinearity elementwise x -> tanh(x) so the output is between -1 and 1. */
export class TanhLayer implements LayerInstance {
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'tanh';

  in_act!: Vol;
  out_act!: Vol;

  constructor(opt: TanhLayerOptions = DEFAULT_TANH_LAYER_OPTIONS) {
    // required
    this.out_sx = opt.in_sx!;
    this.out_sy = opt.in_sy!;
    this.out_depth = opt.in_depth!;
    this.layer_type = 'tanh';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const V2 = V.cloneAndZero();
    const N = V.w.length;
    for (let i = 0; i < N; i++) {
      V2.w[i] = Math.tanh(V.w[i]);
    }
    this.out_act = V2;
    return this.out_act;
  }

  backward(): void {
    const V = this.in_act; // we need to set dw of this
    const V2 = this.out_act;
    const N = V.w.length;
    V.dw = zeros(N); // zero out gradient wrt data
    for (let i = 0; i < N; i++) {
      const v2wi = V2.w[i];
      V.dw[i] = (1.0 - v2wi * v2wi) * V2.dw[i];
    }
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): TanhLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
    };
  }

  fromJSON(json: TanhLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
