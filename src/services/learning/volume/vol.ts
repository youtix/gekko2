import { isNil } from 'lodash-es';
import { randn, zeros } from '../learning.utils';
import { VolJSON } from './vol.types';

/**
 * Vol is the basic building block of all data in a net. It is essentially just a 3D volume of numbers, with a
 * width (sx), height (sy), and depth (depth). It is used to hold data for all filters, all volumes,
 * all weights, and also stores all gradients w.r.t. The data. c is optionally a value to initialize the volume
 * with. If c is missing, fills the Vol with random numbers.
 */
export class Vol {
  /** Width of the volume (number of columns) */
  sx: number;
  /** Height of the volume (number of rows) */
  sy: number;
  /** Depth of the volume (number of channels) */
  depth: number;
  /** Flat data buffer of length sx * sy * depth storing values */
  w: number[] | Float64Array;
  /** Flat buffer of same length as w storing gradients dL/dw */
  dw: number[] | Float64Array;

  constructor(sxOrData: number | number[], sy?: number, depth?: number, c?: number);
  constructor(sxOrData: number | number[], sy: number, depth: number, c?: number) {
    if (Array.isArray(sxOrData)) {
      // we were given a list in sx, assume 1D volume and fill it up
      this.sx = 1;
      this.sy = 1;
      this.depth = sxOrData.length;
      // we have to do the following copy because we want to use
      // fast typed arrays, not an ordinary javascript array
      this.w = zeros(this.depth);
      this.dw = zeros(this.depth);
      for (let i = 0; i < this.depth; i++) {
        this.w[i] = sxOrData[i];
      }
    } else {
      // we were given dimensions of the vol
      const sx = sxOrData;
      const syv = sy;
      const depthv = depth;
      this.sx = sx;
      this.sy = syv;
      this.depth = depthv;
      const n = sx * syv * depthv;
      this.w = zeros(n);
      this.dw = zeros(n);
      if (isNil(c)) {
        // weight normalization is done to equalize the output
        // variance of every neuron, otherwise neurons with a lot
        // of incoming connections have outputs of larger variance
        const scale = Math.sqrt(1.0 / (sx * syv * depthv));
        for (let i = 0; i < n; i++) {
          this.w[i] = randn(0.0, scale);
        }
      } else {
        for (let i = 0; i < n; i++) {
          this.w[i] = c;
        }
      }
    }
  }

  get(x: number, y: number, d: number): number {
    const ix = (this.sx * y + x) * this.depth + d;
    return this.w[ix];
  }

  set(x: number, y: number, d: number, v: number): void {
    const ix = (this.sx * y + x) * this.depth + d;
    this.w[ix] = v;
  }

  add(x: number, y: number, d: number, v: number): void {
    const ix = (this.sx * y + x) * this.depth + d;
    this.w[ix] += v;
  }

  get_grad(x: number, y: number, d: number): number {
    const ix = (this.sx * y + x) * this.depth + d;
    return this.dw[ix];
  }

  set_grad(x: number, y: number, d: number, v: number): void {
    const ix = (this.sx * y + x) * this.depth + d;
    this.dw[ix] = v;
  }

  add_grad(x: number, y: number, d: number, v: number): void {
    const ix = (this.sx * y + x) * this.depth + d;
    this.dw[ix] += v;
  }

  cloneAndZero(): Vol {
    return new Vol(this.sx, this.sy, this.depth, 0.0);
  }

  clone(): Vol {
    const V = new Vol(this.sx, this.sy, this.depth, 0.0);
    const n = this.w.length;
    for (let i = 0; i < n; i++) {
      V.w[i] = this.w[i];
    }
    return V;
  }

  addFrom(V: Vol): void {
    for (let k = 0; k < this.w.length; k++) {
      this.w[k] += V.w[k];
    }
  }

  addFromScaled(V: Vol, a: number): void {
    for (let k = 0; k < this.w.length; k++) {
      this.w[k] += a * V.w[k];
    }
  }

  setConst(a: number): void {
    for (let k = 0; k < this.w.length; k++) {
      this.w[k] = a;
    }
  }

  toJSON(): VolJSON {
    // TODO: we may want to only save d most significant digits to save space
    return {
      sx: this.sx,
      sy: this.sy,
      depth: this.depth,
      w: this.w,
    };
    // we wont back up gradients to save space
  }

  fromJSON(json: VolJSON): void {
    this.sx = json.sx;
    this.sy = json.sy;
    this.depth = json.depth;
    const n = this.sx * this.sy * this.depth;
    this.w = zeros(n);
    this.dw = zeros(n);
    // copy over the elements.
    for (let i = 0; i < n; i++) {
      this.w[i] = json.w[i];
    }
  }
}
