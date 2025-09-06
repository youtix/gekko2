import { LayerInstance } from '@services/learning/learning.types';
import { isNil } from 'lodash-es';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_SOFTMAX_LAYER_OPTIONS } from './softmaxLayer.const';
import { SoftmaxLayerJSON, SoftmaxLayerOptions } from './softmaxLayer.types';

/**
 * Layers that implement a loss. Currently these are the layers that
 * can initiate a backward() pass. In future we probably want a more
 * flexible system that can accomodate multiple losses to do multi-task
 * learning, and stuff like that. But for now, one of the layers in this
 * file must be the final layer in a Net.
 * This is a classifier, with N discrete classes from 0 to N-1
 * it gets a stream of N incoming numbers and computes the softmax
 * function (exponentiate and normalize to sum to 1 as probabilities should)
 */
export class SoftmaxLayer implements LayerInstance {
  /** Total number of input units (in_sx * in_sy * in_depth). */
  num_inputs: number;
  /** Number of output units (equals num_inputs for softmax). */
  out_depth: number;
  /** Output width (classifier outputs are 1x1 spatially). */
  out_sx: number;
  /** Output height (classifier outputs are 1x1 spatially). */
  out_sy: number;
  /** Discriminator for layer serialization and type checks. */
  layer_type: 'softmax';
  /** Cached input activation from the forward pass. */
  in_act!: Vol;
  /** Output activation (probabilities) computed by softmax. */
  out_act!: Vol;
  /** Cached probabilities (sum to 1), reused during backprop. */
  es!: number[] | Float64Array;

  constructor(opt: SoftmaxLayerOptions = DEFAULT_SOFTMAX_LAYER_OPTIONS) {
    // computed
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_depth = this.num_inputs;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'softmax';
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const A = new Vol(1, 1, this.out_depth, 0.0);
    // compute max activation
    const as = V.w as number[] | Float64Array;
    let amax = as[0];
    for (let i = 1; i < this.out_depth; i++) {
      const v = as[i];
      if (v > amax) amax = v;
    }
    // compute exponentials (carefully to not blow up)
    const es = zeros(this.out_depth) as number[] | Float64Array;
    let esum = 0.0;
    for (let i = 0; i < this.out_depth; i++) {
      const e = Math.exp(as[i] - amax);
      esum += e;
      es[i] = e;
    }
    // normalize and output to sum to one
    const Aw = A.w as number[] | Float64Array;
    for (let i = 0; i < this.out_depth; i++) {
      const p = es[i] / esum;
      es[i] = p;
      Aw[i] = p;
    }
    this.es = es; // save these for backprop
    this.out_act = A;
    return this.out_act;
  }

  backward(y: number): number {
    // compute and accumulate gradient wrt weights and bias of this layer
    const x = this.in_act;
    x.dw = zeros(x.w.length); // zero out the gradient of input Vol
    for (let i = 0; i < this.out_depth; i++) {
      const yi = y;
      const indicator = i === yi ? 1.0 : 0.0;
      const mul = -(indicator - this.es[i]);
      x.dw[i] = mul;
    }
    if (isNil(y)) throw new Error('y cannot be empty');
    // loss is the class negative log likelihood
    return -Math.log(this.es[y]);
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): SoftmaxLayerJSON {
    return {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      num_inputs: this.num_inputs,
    };
  }

  fromJSON(json: SoftmaxLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.num_inputs = json.num_inputs;
  }
}
