import { SVMLayer } from '@services/learning/layer/svm/svmLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('SVMLayer', () => {
  // forward: identity mapping, preserves input and returns same Vol
  it.each`
    name                         | input
    ${'single value'}            | ${[7]}
    ${'mixed positive/negative'} | ${[1, -2, 3]}
    ${'zeros and decimals'}      | ${[0, 0.25, -0.5, 2]}
  `('forward() identity: $name', ({ input }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new SVMLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);
    const actual = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
    };
    expect(actual).toEqual({ sameObject: true, out: input as number[], input: input as number[] });
  });

  // backward: multi-class hinge loss gradients and loss accumulation
  // Note: implementation includes margin term for i == yi as a constant loss (+1) without affecting gradients.
  it.each`
    name                                   | input            | yi   | expectedGrad  | expectedLoss
    ${'two violations vs class 0'}         | ${[1, 2, 3]}     | ${0} | ${[-2, 1, 1]} | ${6}
    ${'no violations beyond constant'}     | ${[5, 4, 3]}     | ${0} | ${[0, 0, 0]}  | ${1}
    ${'label at end, no extra violations'} | ${[-1, 0, 1]}    | ${2} | ${[0, 0, 0]}  | ${1}
    ${'mixed, two competitors'}            | ${[0.1, 0.9, 0]} | ${0} | ${[-2, 1, 1]} | ${3.6999999999999997}
  `('backward() hinge loss: $name', ({ input, yi, expectedGrad, expectedLoss }) => {
    const v = new Vol(input, 0, 0);
    const layer = new SVMLayer({ in_sx: 1, in_sy: 1, in_depth: input.length });
    layer.forward(v, true);
    const loss = layer.backward(yi as number);
    const grad = Array.from(v.dw as number[] | Float64Array);
    expect({ grad, loss }).toEqual({ grad: expectedGrad as number[], loss: expectedLoss as number });
  });

  // JSON roundtrip preserves computed properties
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new SVMLayer(config);
    const json = layer.toJSON();
    const layer2 = new SVMLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
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
    const layer = new SVMLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
