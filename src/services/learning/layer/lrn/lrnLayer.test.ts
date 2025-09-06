import { LRNLayer } from '@services/learning/layer/lrn/lrnLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('LRNLayer', () => {
  // forward: normalizes across depth with sliding window of size n
  it.each`
    name                        | input               | opt
    ${'depth=5 simple values'}  | ${[1, 2, 3, 4, 5]}  | ${{ in_sx: 1, in_sy: 1, in_depth: 5, k: 2, n: 3, alpha: 2, beta: 0.5 }}
    ${'depth=3 with negatives'} | ${[0.5, -1.0, 2.0]} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, k: 1, n: 3, alpha: 1, beta: 0.75 }}
  `('forward() normalization across depth: $name', ({ input, opt }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new LRNLayer(opt as any);
    const out = layer.forward(v, true);

    const values = input as number[];
    const { k, n, alpha, beta } = opt as { k: number; n: number; alpha: number; beta: number };
    const n2 = Math.floor(n / 2);
    const expectedOut = values.map((ai, i) => {
      let den = 0;
      for (let j = Math.max(0, i - n2); j <= Math.min(i + n2, values.length - 1); j++) den += values[j] * values[j];
      den = Math.pow(k + (alpha / n) * den, beta);
      return ai / den;
    });

    const snapshot = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
      shape: { sx: out.sx, sy: out.sy, depth: out.depth },
    };

    expect(snapshot).toEqual({
      sameObject: false,
      out: expectedOut,
      input: input as number[],
      shape: { sx: 1, sy: 1, depth: (input as number[]).length },
    });
  });

  // backward: expected gradient via closed-form accumulation across window
  it.each`
    name                            | input                          | upstream                        | opt
    ${'depth=5 window=3'}           | ${[1.0, -0.5, 2.0, -1.5, 0.7]} | ${[0.2, -0.1, 0.05, 1.0, -0.3]} | ${{ in_sx: 1, in_sy: 1, in_depth: 5, k: 2, n: 3, alpha: 2, beta: 0.75 }}
    ${'depth=3 window=3 uniform g'} | ${[0.5, -1.0, 2.0]}            | ${[1, 1, 1]}                    | ${{ in_sx: 1, in_sy: 1, in_depth: 3, k: 1.5, n: 3, alpha: 1.2, beta: 0.6 }}
  `('backward() gradient accumulation: $name', ({ input, upstream, opt }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new LRNLayer(opt as any);
    const out = layer.forward(v, true);

    // set upstream gradient into out.dw
    const outdw = out.dw as number[] | Float64Array;
    (upstream as number[]).forEach((g, i) => {
      outdw[i] = g;
    });
    layer.backward();

    // expected gradient computed with the same closed-form as in the layer
    const values = input as number[];
    const gUp = upstream as number[];
    const { k, n, alpha, beta } = opt as { k: number; n: number; alpha: number; beta: number };
    const n2 = Math.floor(n / 2);
    // precompute S(i) for all i
    const S: number[] = values.map((_, i) => {
      let den = 0;
      for (let j = Math.max(0, i - n2); j <= Math.min(i + n2, values.length - 1); j++) den += values[j] * values[j];
      return k + (alpha / n) * den;
    });
    const expectedGrad: number[] = new Array(values.length).fill(0);
    for (let i = 0; i < values.length; i++) {
      const Si = S[i];
      const SB = Math.pow(Si, beta);
      const SB2 = SB * SB;
      const chain = gUp[i];
      for (let j = Math.max(0, i - n2); j <= Math.min(i + n2, values.length - 1); j++) {
        const aj = values[j];
        let g = ((-aj * beta * Math.pow(Si, beta - 1) * alpha) / n) * 2 * aj;
        if (j === i) g += SB;
        g /= SB2;
        g *= chain;
        expectedGrad[j] += g;
      }
    }

    const actualGrad = Array.from(v.dw as number[] | Float64Array);
    expect(actualGrad).toEqual(expectedGrad);
  });

  // JSON roundtrip preserves layer config
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, k: 2, n: 3, alpha: 2, beta: 0.5 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4, k: 1.5, n: 5, alpha: 1, beta: 0.75 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new LRNLayer(config as any);
    const json = layer.toJSON();
    const layer2 = new LRNLayer({ in_sx: 1, in_sy: 1, in_depth: 1, k: 1, n: 3, alpha: 1, beta: 1 });
    layer2.fromJSON(json);
    const snapshot = {
      k: layer2.k,
      n: layer2.n,
      alpha: layer2.alpha,
      beta: layer2.beta,
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      layer_type: layer2.layer_type,
    };
    expect(snapshot).toEqual({
      k: json.k,
      n: json.n,
      alpha: json.alpha,
      beta: json.beta,
      out_sx: json.out_sx,
      out_sy: json.out_sy,
      out_depth: json.out_depth,
      layer_type: json.layer_type,
    });
  });

  // params/grads: no trainable parameters
  it('getParamsAndGrads returns empty array', () => {
    const layer = new LRNLayer({ in_sx: 1, in_sy: 1, in_depth: 3, k: 2, n: 3, alpha: 2, beta: 0.5 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
