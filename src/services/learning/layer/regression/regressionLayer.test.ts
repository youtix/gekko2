import { RegressionLayer } from '@services/learning/layer/regression/regressionLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('RegressionLayer', () => {
  // forward: identity mapping, preserves input and returns same Vol
  it.each`
    name                         | input
    ${'single value'}            | ${[42]}
    ${'mixed positive/negative'} | ${[1, -2, 3]}
    ${'zeros and decimals'}      | ${[0, 0.5, -0.5, 2]}
  `('forward() identity: $name', ({ input }: { input: number[] }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new RegressionLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);
    const actual = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
    };
    expect(actual).toEqual({ sameObject: true, out: input as number[], input: input as number[] });
  });

  // backward: array/Float64 targets compute grad = x - y and loss = 2 * sum(dy^2)
  it.each`
    name                             | input        | target                           | expectedGrad   | expectedLoss
    ${'simple integers'}             | ${[1, 2, 3]} | ${[0, 1, 4]}                     | ${[1, 1, -1]}  | ${6}
    ${'negative diffs'}              | ${[-3, 0]}   | ${[-1, 2]}                       | ${[-2, -2]}    | ${16}
    ${'Float64Array target support'} | ${[1, -2]}   | ${new Float64Array([0.5, -1.5])} | ${[0.5, -0.5]} | ${1}
  `('backward() array target: $name', ({ input, target, expectedGrad, expectedLoss }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new RegressionLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    layer.forward(v, true);
    const loss = layer.backward(target as number[] | Float64Array);
    const grad = Array.from(v.dw as number[] | Float64Array);
    expect({ grad, loss }).toEqual({ grad: expectedGrad as number[], loss: expectedLoss as number });
  });

  // backward: single-dimension regression target { dim, val }
  it.each`
    name                              | input        | target                 | expectedGrad | expectedLoss
    ${'update middle index'}          | ${[2, 4, 6]} | ${{ dim: 1, val: 3 }}  | ${[0, 1, 0]} | ${2}
    ${'single element negative diff'} | ${[5]}       | ${{ dim: 0, val: 10 }} | ${[-5]}      | ${50}
  `('backward() dim target: $name', ({ input, target, expectedGrad, expectedLoss }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new RegressionLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    layer.forward(v, true);
    const loss = layer.backward(target as { dim: number; val: number });
    const grad = Array.from(v.dw as number[] | Float64Array);
    expect({ grad, loss }).toEqual({ grad: expectedGrad as number[], loss: expectedLoss as number });
  });

  // JSON roundtrip preserves computed properties
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ config }: { config: { in_sx: number; in_sy: number; in_depth: number } }) => {
    const layer = new RegressionLayer(config as { in_sx: number; in_sy: number; in_depth: number });
    const json = layer.toJSON();
    const layer2 = new RegressionLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
    layer2.fromJSON(json);
    const snapshot = {
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      layer_type: layer2.layer_type,
      num_inputs: layer2.num_inputs,
    };
    expect(snapshot).toEqual({
      out_sx: json.out_sx,
      out_sy: json.out_sy,
      out_depth: json.out_depth,
      layer_type: json.layer_type,
      num_inputs: json.num_inputs,
    });
  });

  // params/grads: no trainable parameters
  it('getParamsAndGrads returns empty array', () => {
    const layer = new RegressionLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
