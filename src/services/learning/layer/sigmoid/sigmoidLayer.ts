import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_SIGMOID_LAYER_OPTIONS } from './sigmoidLayer.const';
import { SigmoidLayerJSON, SigmoidLayerOptions } from './sigmoidLayer.types';

/** Implements Sigmoid nnonlinearity elementwise x -> 1/(1+e^(-x)) so the output is between 0 and 1. */
export class SigmoidLayer implements LayerInstance {
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'sigmoid';

  in_act!: Vol;
  out_act!: Vol;

  constructor(opt: SigmoidLayerOptions = DEFAULT_SIGMOID_LAYER_OPTIONS) {
    this.out_sx = opt.in_sx;
    this.out_sy = opt.in_sy;
    this.out_depth = opt.in_depth;
    this.layer_type = 'sigmoid';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const V2 = V.cloneAndZero();
    const N = V.w.length;
    const V2w = V2.w;
    const Vw = V.w;
    for (let i = 0; i < N; i++) {
      V2w[i] = 1.0 / (1.0 + Math.exp(-Vw[i]));
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
      V.dw[i] = v2wi * (1.0 - v2wi) * V2.dw[i];
    }
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): SigmoidLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
    };
  }

  fromJSON(json: SigmoidLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
