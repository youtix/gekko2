import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { ParamGrad } from '../conv/convLayer.types';
import { DEFAULT_FULLY_CONN_LAYER_OPTIONS } from './fullyConnLayer.const';
import { FullyConnLayerJSON, FullyConnLayerOptions } from './fullyConnLayer.types';

/**
 * This file contains FullyConn layer that do dot products with input,
 * but usually in a different connectivity pattern and weight sharing
 * schemes:
 * - FullyConn is fully connected dot products
 */
export class FullyConnLayer implements LayerInstance {
  /** Layer identifier ('fc') */
  layer_type: 'fc';
  /** Number of neurons (output depth) */
  out_depth: number;
  /** L1 decay multiplier */
  l1_decay_mul: number;
  /** L2 decay multiplier */
  l2_decay_mul: number;
  /** Flattened input size: in_sx * in_sy * in_depth */
  num_inputs: number;
  /** Output width (always 1 for FC) */
  out_sx: number;
  /** Output height (always 1 for FC) */
  out_sy: number;
  /** Weight vectors, one Vol per neuron */
  filters: Vol[];
  /** Bias terms for each neuron */
  biases: Vol;
  /** Cached input activation */
  in_act!: Vol;
  /** Cached output activation */
  out_act!: Vol;

  constructor(opt: FullyConnLayerOptions = DEFAULT_FULLY_CONN_LAYER_OPTIONS) {
    // required
    // ok fine we will allow 'filters' as the word as well
    this.out_depth = opt.num_neurons ?? opt.filters;

    // optional
    this.l1_decay_mul = opt.l1_decay_mul ?? 0.0;
    this.l2_decay_mul = opt.l2_decay_mul ?? 1.0;

    // computed
    this.num_inputs = opt.in_sx * opt.in_sy * opt.in_depth;
    this.out_sx = 1;
    this.out_sy = 1;
    this.layer_type = 'fc';

    // initializations
    const bias = opt.bias_pref ?? 0.0;
    this.filters = [];
    for (let i = 0; i < this.out_depth; i++) {
      this.filters.push(new Vol(1, 1, this.num_inputs));
    }
    this.biases = new Vol(1, 1, this.out_depth, bias);
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const A = new Vol(1, 1, this.out_depth, 0.0);
    const Vw = V.w;
    for (let i = 0; i < this.out_depth; i++) {
      let a = 0.0;
      const wi = this.filters[i].w;
      for (let d = 0; d < this.num_inputs; d++) {
        a += Vw[d] * wi[d]; // for efficiency use Vols directly for now
      }
      a += this.biases.w[i];
      A.w[i] = a;
    }
    this.out_act = A;
    return this.out_act;
  }

  backward(): void {
    const V = this.in_act;
    V.dw = zeros(V.w.length); // zero out the gradient in input Vol
    // compute gradient wrt weights and data
    for (let i = 0; i < this.out_depth; i++) {
      const tfi = this.filters[i];
      const chain_grad = this.out_act.dw[i];
      for (let d = 0; d < this.num_inputs; d++) {
        V.dw[d] += tfi.w[d] * chain_grad; // grad wrt input data
        tfi.dw[d] += V.w[d] * chain_grad; // grad wrt params
      }
      this.biases.dw[i] += chain_grad;
    }
  }

  getParamsAndGrads(): ParamGrad[] {
    const response: ParamGrad[] = [];
    for (let i = 0; i < this.out_depth; i++) {
      response.push({
        params: this.filters[i].w,
        grads: this.filters[i].dw,
        l1_decay_mul: this.l1_decay_mul,
        l2_decay_mul: this.l2_decay_mul,
      });
    }
    response.push({ params: this.biases.w, grads: this.biases.dw, l1_decay_mul: 0.0, l2_decay_mul: 0.0 });
    return response;
  }

  toJSON(): FullyConnLayerJSON {
    const json: FullyConnLayerJSON = {
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      num_inputs: this.num_inputs,
      l1_decay_mul: this.l1_decay_mul,
      l2_decay_mul: this.l2_decay_mul,
      filters: [],
    };
    for (let i = 0; i < this.filters.length; i++) {
      json.filters.push(this.filters[i].toJSON());
    }
    json.biases = this.biases.toJSON();
    return json;
  }

  fromJSON(json: FullyConnLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.num_inputs = json.num_inputs;
    this.l1_decay_mul = typeof json.l1_decay_mul !== 'undefined' ? json.l1_decay_mul : 1.0;
    this.l2_decay_mul = typeof json.l2_decay_mul !== 'undefined' ? json.l2_decay_mul : 1.0;
    this.filters = [] as Vol[];
    for (let i = 0; i < json.filters.length; i++) {
      const v = new Vol(0, 0, 0, 0);
      v.fromJSON(json.filters[i]);
      this.filters.push(v);
    }
    this.biases = new Vol(0, 0, 0, 0);
    if (json.biases) this.biases.fromJSON(json.biases);
  }
}
