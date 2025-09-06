import { describe, expect, it } from 'vitest';
import { Vol } from '../../volume/vol';
import { QuadTransformLayer } from './quadTransformLayer';

describe('QuadTransformLayer', () => {
  describe('forward', () => {
    it.each`
      in_sx | in_sy | in_depth | input         | expected
      ${1}  | ${1}  | ${2}     | ${[2, 3]}     | ${[2, 3, 4, 6, 6, 9]}
      ${1}  | ${1}  | ${3}     | ${[1, -2, 4]} | ${[1, -2, 4, 1, -2, 4, -2, 4, -8, 4, -8, 16]}
    `('produces linear and quadratic terms (depth=$in_depth)', ({ in_sx, in_sy, in_depth, input, expected }) => {
      const layer = new QuadTransformLayer({ in_sx, in_sy, in_depth });
      const V = new Vol(input as number[], 1, 1);
      const out = layer.forward(V);

      // one expect per test: verify shape and values together
      expect({
        out_sx: out.sx,
        out_sy: out.sy,
        out_depth: out.depth,
        values: Array.from(out.w),
      }).toEqual({ out_sx: in_sx, out_sy: in_sy, out_depth: in_depth + in_depth * in_depth, values: expected });
    });
  });

  describe('backward', () => {
    it.each`
      input         | chainGrad | expectedGrad
      ${[2, 3]}     | ${1}      | ${[11, 11]}
      ${[1, -2, 4]} | ${1}      | ${[7, 7, 7]}
    `('propagates correct gradients for input=$input', ({ input, chainGrad, expectedGrad }) => {
      const in_depth = (input as number[]).length;
      const layer = new QuadTransformLayer({ in_sx: 1, in_sy: 1, in_depth });
      const V = new Vol(input as number[], 1, 1);
      const out = layer.forward(V);
      // set upstream gradient to chainGrad for every output position
      for (let d = 0; d < out.depth; d++) {
        out.set_grad(0, 0, d, chainGrad as number);
      }
      layer.backward();
      // one expect per test
      expect(Array.from(V.dw)).toEqual(expectedGrad);
    });
  });

  describe('serialization', () => {
    it.each`
      in_sx | in_sy | in_depth
      ${1}  | ${1}  | ${2}
      ${2}  | ${3}  | ${4}
    `('toJSON/fromJSON preserve layer fields ($in_sx,$in_sy,$in_depth)', ({ in_sx, in_sy, in_depth }) => {
      const layer = new QuadTransformLayer({ in_sx, in_sy, in_depth });
      const json = layer.toJSON();

      const fresh = new QuadTransformLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
      fresh.fromJSON(json);
      // one expect per test
      expect(fresh.toJSON()).toEqual({
        out_depth: in_depth + in_depth * in_depth,
        out_sx: in_sx,
        out_sy: in_sy,
        layer_type: 'quadtransform',
      });
    });
  });
});
