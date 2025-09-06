import { TanhLayer } from '@services/learning/layer/tanh/tanhLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('TanhLayer', () => {
  // forward: elementwise tanh, returns new Vol, input unchanged
  it.each`
    name                              | input
    ${'single zero'}                  | ${[0]}
    ${'mixed small values'}           | ${[1, -2, 0.5, -0.75]}
    ${'near-saturation large values'} | ${[10, -10, 5, -5]}
    ${'zeros and decimals'}           | ${[0, 0.25, -0.5, 2]}
  `('forward() elementwise tanh: $name', ({ input }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new TanhLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);

    const actual = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
    };

    const expectedOut = (input as number[]).map(x => Math.tanh(x));
    expect(actual).toEqual({ sameObject: false, out: expectedOut, input: input as number[] });
  });

  // backward: d/dx tanh(x) = (1 - tanh(x)^2) * upstream
  it.each`
    name                             | input                    | upstream
    ${'unit upstream'}               | ${[0, 1, -1, 0.5, -0.5]} | ${[1, 1, 1, 1, 1]}
    ${'custom upstream mix'}         | ${[10, -10, 2, -2]}      | ${[0.1, -0.1, 3, -3]}
    ${'zeros upstream leaves zeros'} | ${[3, -3, 0]}            | ${[0, 0, 0]}
  `('backward() gradient: $name', ({ input, upstream }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new TanhLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);
    // set upstream gradient into out.dw
    const dw = out.dw as number[] | Float64Array;
    (upstream as number[]).forEach((g, i) => {
      dw[i] = g;
    });
    layer.backward();

    const actualGrad = Array.from(v.dw as number[] | Float64Array);
    const expectedGrad = (input as number[]).map((x, i) => {
      const t = Math.tanh(x);
      return (1 - t * t) * (upstream as number[])[i];
    });

    expect(actualGrad).toEqual(expectedGrad);
  });

  // JSON roundtrip preserves layer config
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new TanhLayer(config as { in_sx: number; in_sy: number; in_depth: number });
    const json = layer.toJSON();
    const layer2 = new TanhLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
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
    const layer = new TanhLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
