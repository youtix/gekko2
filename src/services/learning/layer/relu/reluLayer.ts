import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_RELU_LAYER_OPTIONS } from './reluLayer.const';
import { ReluLayerJSON, ReluLayerOptions } from './reluLayer.types';

/** Implements ReLU nonlinearity elementwise x -> max(0, x) the output is in [0, inf) */
export class ReluLayer implements LayerInstance {
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'relu';

  in_act!: Vol;
  out_act!: Vol;

  constructor(opt: ReluLayerOptions = DEFAULT_RELU_LAYER_OPTIONS) {
    this.out_sx = opt.in_sx;
    this.out_sy = opt.in_sy;
    this.out_depth = opt.in_depth;
    this.layer_type = 'relu';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const V2 = V.clone();
    const N = V.w.length;
    const V2w = V2.w;
    for (let i = 0; i < N; i++) {
      if (V2w[i] < 0) V2w[i] = 0; // threshold at 0
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
      if (V2.w[i] <= 0)
        V.dw[i] = 0; // threshold
      else V.dw[i] = V2.dw[i];
    }
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): ReluLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
    };
  }

  fromJSON(json: ReluLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
