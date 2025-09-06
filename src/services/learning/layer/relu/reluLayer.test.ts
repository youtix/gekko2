import { ReluLayer } from '@services/learning/layer/relu/reluLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('ReluLayer', () => {
  // forward: elementwise ReLU, returns new Vol, input unchanged, shape preserved
  it.each`
    name                           | input
    ${'single zero'}               | ${[0]}
    ${'mixed negatives/positives'} | ${[-1, 2, -0.5, 3, 0]}
    ${'all negatives'}             | ${[-3, -2, -1]}
    ${'all positives'}             | ${[0.1, 2, 5]}
  `('forward() elementwise relu: $name', ({ input }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new ReluLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);

    const actual = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
      shape: { sx: out.sx, sy: out.sy, depth: out.depth },
    };

    const expectedOut = (input as number[]).map(x => (x < 0 ? 0 : x));
    expect(actual).toEqual({
      sameObject: false,
      out: expectedOut,
      input: input as number[],
      shape: { sx: 1, sy: 1, depth: (input as number[]).length },
    });
  });

  // backward: pass upstream where output>0, else 0 (uses out.w <= 0 threshold)
  it.each`
    name                               | input                  | upstream
    ${'mixed with zeros'}              | ${[-1, 0, 2, -0.5, 3]} | ${[1, 2, 3, 4, 5]}
    ${'all negatives -> zero grads'}   | ${[-3, -2, -1]}        | ${[7, 8, 9]}
    ${'all positives -> pass through'} | ${[0.1, 2, 5]}         | ${[10, 11, 12]}
  `('backward() gradient flow: $name', ({ input, upstream }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new ReluLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);

    // set upstream gradient into out.dw
    const dw = out.dw as number[] | Float64Array;
    (upstream as number[]).forEach((g, i) => {
      dw[i] = g;
    });
    layer.backward();

    const actualGrad = Array.from(v.dw as number[] | Float64Array);
    const expectedGrad = (input as number[]).map((x, i) => (x > 0 ? 1 : 0) * (upstream as number[])[i]);

    expect(actualGrad).toEqual(expectedGrad);
  });

  // JSON roundtrip preserves layer config
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new ReluLayer(config);
    const json = layer.toJSON();
    const layer2 = new ReluLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
    layer2.fromJSON(json);
    const snapshot = {
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      layer_type: layer2.layer_type,
    };
    expect(snapshot).toEqual({
      out_sx: json.out_sx,
      out_sy: json.out_sy,
      out_depth: json.out_depth,
      layer_type: json.layer_type,
    });
  });

  // params/grads: no trainable parameters
  it('getParamsAndGrads returns empty array', () => {
    const layer = new ReluLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
