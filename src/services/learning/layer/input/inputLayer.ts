import { LayerInstance } from '@services/learning/learning.types';
import { Vol } from '../../volume/vol';
import { DEFAULT_INPUT_LAYER_OPTIONS } from './inputLayer.const';
import { InputLayerJSON, InputLayerOptions } from './inputLayer.types';
/**
 * InputLayer
 * Defines the network's input shape and passes data through unchanged.
 * - forward: identity (stores and returns the input `Vol`)
 * - backward: no-op (no parameters/gradients)
 * Used as the first layer to establish `out_sx`, `out_sy`, and `out_depth`.
 */
export class InputLayer implements LayerInstance {
  out_sx: number;
  out_sy: number;
  out_depth: number;
  layer_type: 'input';

  in_act!: Vol;
  out_act!: Vol;

  constructor(opt: Partial<InputLayerOptions> = DEFAULT_INPUT_LAYER_OPTIONS) {
    // allow specifying either input or output dims (they're identical here)
    this.out_sx = (opt.out_sx ?? opt.in_sx)!;
    this.out_sy = (opt.out_sy ?? opt.in_sy)!;
    this.out_depth = (opt.out_depth ?? opt.in_depth)!;
    this.layer_type = 'input';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    this.out_act = V;
    return this.out_act; // identity
  }

  backward(): void {
    // no params, no gradients to propagate here
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): InputLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
    };
  }

  fromJSON(json: InputLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
  }
}
