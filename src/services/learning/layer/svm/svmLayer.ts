import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_SVM_LAYER_OPTIONS } from './svmLayer.const';
import { SVMLayerJSON, SVMLayerOptions } from './svmLayer.types';

/**
 * Multiclass linear SVM output layer.
 *
 * - Forwards input scores unchanged (identity forward pass).
 * - Computes multi-class hinge-loss gradients (margin = 1.0) w.r.t. inputs.
 * - Holds no trainable parameters; gradients propagate directly to previous layers.
 * - Output shape is 1x1xN where N equals the number of input units.
 */
export class SVMLayer implements LayerInstance {
  /** Constant layer identifier used for (de)serialization. */
  layer_type: 'svm';
  /** Total number of input units (in_sx * in_sy * in_depth). */
  num_inputs: number;
  /** Output depth (number of class scores); equals `num_inputs`. */
  out_depth: number;
  /** Output width; always 1. */
  out_sx: number;
  /** Output height; always 1. */
  out_sy: number;
  /** Cached input activations (used during backprop). */
  in_act!: Vol;
  /** Output activations (alias of input for this layer). */
  out_act!: Vol;

  constructor(opt: SVMLayerOptions = DEFAULT_SVM_LAYER_OPTIONS) {
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'svm';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    this.out_act = V; // nothing to do, output raw scores
    return V;
  }

  backward(y: number): number {
    // compute and accumulate gradient wrt weights and bias of this layer
    const x = this.in_act;
    x.dw = zeros(x.w.length); // zero out the gradient of input Vol
    const yi = y;
    const yscore = x.w[yi]; // score of ground truth
    const margin = 1.0;
    let loss = 0.0;
    for (let i = 0; i < this.out_depth; i++) {
      if (-yscore + (x.w[i] as number) + margin > 0) {
        // violating example, apply loss
        // I love hinge loss, by the way. Truly.
        // Seriously, compare this SVM code with Softmax forward AND backprop code above
        // it's clear which one is superior, not only in code, simplicity
        // and beauty, but also in practice.
        x.dw[i] += 1;
        x.dw[yi] -= 1;
        loss += -yscore + (x.w[i] as number) + margin;
      }
    }
    return loss;
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): SVMLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      num_inputs: this.num_inputs,
    };
  }

  fromJSON(json: SVMLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.num_inputs = json.num_inputs;
  }
}
