import { LayerInstance } from '@services/learning/learning.types';
import { zeros } from '../../learning.utils';
import { Vol } from '../../volume/vol';
import { DEFAULT_POOL_LAYER_OPTIONS } from './poolLayer.const';
import { PoolLayerJSON, PoolLayerOptions } from './poolLayer.types';

/**
 * Max-pooling layer.
 *
 * Slides a window of size `sx x sy` across the input volume with the given
 * `stride` and optional zero `pad`, taking the maximum value in each window.
 * The layer reduces the spatial resolution while keeping the channel depth.
 *
 * During the forward pass it stores, for every output neuron, the input
 * coordinates where the maximum was found (`switchx`, `switchy`). Those
 * locations are then used in the backward pass to route the gradient only to
 * the winning input element (argmax), which makes backpropagation O(1) per
 * output.
 */
export class PoolLayer implements LayerInstance {
  /** Pooling window width (x dimension). */
  sx: number;
  /** Number of input channels/depth. */
  in_depth: number;
  /** Input width in pixels (x). */
  in_sx: number;
  /** Input height in pixels (y). */
  in_sy: number;
  /** Pooling window height (y dimension). Defaults to `sx`. */
  sy: number;
  /** Stride with which the window is moved across the input. */
  stride: number;
  /** Amount of zero-padding added around the input borders. */
  pad: number;
  /** Output depth (same as `in_depth` for pooling). */
  out_depth: number;
  /** Output width after pooling. */
  out_sx: number;
  /** Output height after pooling. */
  out_sy: number;
  /** Discriminator to identify this layer type. */
  layer_type: 'pool';
  /**
   * X-coordinates of argmax positions for each output neuron, stored linearly.
   * Length equals `out_sx * out_sy * out_depth`.
   */
  switchx: number[] | Float64Array;
  /**
   * Y-coordinates of argmax positions for each output neuron, stored linearly.
   * Length equals `out_sx * out_sy * out_depth`.
   */
  switchy: number[] | Float64Array;
  /** Cached input volume from the last forward pass. */
  in_act!: Vol;
  /** Output volume produced by the last forward pass. */
  out_act!: Vol;

  constructor(opt: PoolLayerOptions = DEFAULT_POOL_LAYER_OPTIONS) {
    // required
    this.sx = opt.sx; // filter size
    this.in_depth = opt.in_depth;
    this.in_sx = opt.in_sx;
    this.in_sy = opt.in_sy;

    // optional
    this.sy = opt.sy ?? this.sx;
    this.stride = opt.stride ?? 2;
    this.pad = opt.pad ?? 0; // amount of 0 padding to add around borders of input volume

    // computed
    this.out_depth = this.in_depth;
    this.out_sx = Math.floor((this.in_sx + this.pad * 2 - this.sx) / this.stride + 1);
    this.out_sy = Math.floor((this.in_sy + this.pad * 2 - this.sy) / this.stride + 1);
    this.layer_type = 'pool';

    // store switches for x,y coordinates for where the max comes from, for each output neuron
    this.switchx = zeros(this.out_sx * this.out_sy * this.out_depth);
    this.switchy = zeros(this.out_sx * this.out_sy * this.out_depth);
  }

  forward(V: Vol, _is_training?: boolean): Vol {
    this.in_act = V;
    const A = new Vol(this.out_sx, this.out_sy, this.out_depth, 0.0);
    let n = 0; // a counter for switches
    for (let d = 0; d < this.out_depth; d++) {
      let x = -this.pad;
      let y = -this.pad;
      for (let ax = 0; ax < this.out_sx; x += this.stride, ax++) {
        y = -this.pad;
        for (let ay = 0; ay < this.out_sy; y += this.stride, ay++) {
          // convolve centered at this particular location
          let a = -99999; // hopefully small enough ;\
          let winx = -1,
            winy = -1;
          for (let fx = 0; fx < this.sx; fx++) {
            for (let fy = 0; fy < this.sy; fy++) {
              const oy = y + fy;
              const ox = x + fx;
              if (oy >= 0 && oy < V.sy && ox >= 0 && ox < V.sx) {
                const v = V.get(ox, oy, d);
                // perform max pooling and store pointers to where
                // the max came from. This will speed up backprop
                // and can help make nice visualizations in future
                if (v > a) {
                  a = v;
                  winx = ox;
                  winy = oy;
                }
              }
            }
          }
          this.switchx[n] = winx;
          this.switchy[n] = winy;
          n++;
          A.set(ax, ay, d, a);
        }
      }
    }
    this.out_act = A;
    return this.out_act;
  }

  backward(): void {
    // pooling layers have no parameters, so simply compute
    // gradient wrt data here
    const V = this.in_act;
    V.dw = zeros(V.w.length); // zero out gradient wrt data
    let n = 0;
    for (let d = 0; d < this.out_depth; d++) {
      for (let ax = 0; ax < this.out_sx; ax++) {
        for (let ay = 0; ay < this.out_sy; ay++) {
          const chain_grad = this.out_act.get_grad(ax, ay, d);
          V.add_grad(this.switchx[n], this.switchy[n], d, chain_grad);
          n++;
        }
      }
    }
  }

  getParamsAndGrads(): [] {
    return [];
  }

  toJSON(): PoolLayerJSON {
    return {
      sx: this.sx,
      sy: this.sy,
      stride: this.stride,
      in_depth: this.in_depth,
      out_depth: this.out_depth,
      out_sx: this.out_sx,
      out_sy: this.out_sy,
      layer_type: this.layer_type,
      pad: this.pad,
    };
  }

  fromJSON(json: PoolLayerJSON): void {
    this.out_depth = json.out_depth;
    this.out_sx = json.out_sx;
    this.out_sy = json.out_sy;
    this.layer_type = json.layer_type;
    this.sx = json.sx;
    this.sy = json.sy;
    this.stride = json.stride;
    this.in_depth = json.in_depth;
    this.pad = typeof json.pad !== 'undefined' ? json.pad : 0; // backwards compatibility
    this.switchx = zeros(this.out_sx * this.out_sy * this.out_depth); // need to re-init these appropriately
    this.switchy = zeros(this.out_sx * this.out_sy * this.out_depth);
  }
}
