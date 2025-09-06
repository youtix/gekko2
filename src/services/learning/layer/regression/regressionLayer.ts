import { LayerInstance, RegressionTarget } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_REGRESSION_LAYER_OPTIONS } from './regressionLayer.const';
import { RegressionLayerJSON, RegressionLayerOptions } from './regressionLayer.types';
/**
 * Implements an L2 regression cost layer, so penalizes \sum_i(||x_i - y_i||^2), where x is its input
 * and y is the user-provided array of "correct" values.
 */
export class RegressionLayer implements LayerInstance {
  /** Constant layer identifier used for (de)serialization. */
  layer_type: 'regression';
  /** Total number of input units (in_sx * in_sy * in_depth). */
  num_inputs: number;
  /** Output depth equals number of inputs. */
  out_depth: number;
  /** Output width; always 1 for regression. */
  out_sx: number;
  /** Output height; always 1 for regression. */
  out_sy: number;
  /** Cached input activation from the forward pass. */
  in_act!: Vol;
  /** Output activation (alias of input for this layer). */
  out_act!: Vol;

  constructor(opt: RegressionLayerOptions = DEFAULT_REGRESSION_LAYER_OPTIONS) {
    // computed
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'regression';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    this.out_act = V;
    return V; // identity function
  }

  // y isa list here of size num_inputs
  backward(y: RegressionTarget): number {
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

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): RegressionLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      num_inputs: this.num_inputs,
    };
  }
  fromJSON(json: RegressionLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.num_inputs = json.num_inputs;
  }
}
