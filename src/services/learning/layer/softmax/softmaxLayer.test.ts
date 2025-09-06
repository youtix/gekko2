import { SoftmaxLayer } from '@services/learning/layer/softmax/softmaxLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('SoftmaxLayer', () => {
  // forward: outputs probabilities (sum to 1), shape 1x1xD, input unchanged
  it.each`
    name                         | input
    ${'single value'}            | ${[7]}
    ${'mixed positive/negative'} | ${[1, -2, 3]}
    ${'uniform zeros'}           | ${[0, 0, 0]}
    ${'large values (stable)'}   | ${[1000, 1001, 1002]}
  `('forward() probabilities: $name', ({ input }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out = layer.forward(v, true);

    // expected via stable softmax (subtract max)
    const amax = Math.max(...(input as number[]));
    const es = (input as number[]).map(x => Math.exp(x - amax));
    const esum = es.reduce((a, b) => a + b, 0);
    const expectedOut = es.map(e => e / esum);

    const actual = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
      shape: { sx: out.sx, sy: out.sy, depth: out.depth },
    };
    expect(actual).toEqual({
      sameObject: false,
      out: expectedOut,
      input: input as number[],
      shape: { sx: 1, sy: 1, depth: (input as number[]).length },
    });
  });

  // forward invariance: adding same constant to all inputs doesn't change probabilities
  it.each`
    name                  | input                | shift
    ${'zeros to tens'}    | ${[0, 0, 0]}         | ${10}
    ${'mixed + constant'} | ${[1, -2, 3]}        | ${5}
    ${'large + constant'} | ${[1000, 1001, 999]} | ${-50}
  `('forward() shift invariance: $name', ({ input, shift }) => {
    const v1 = new Vol(input as number[], 0, 0);
    const v2 = new Vol(
      (input as number[]).map(x => x + (shift as number)),
      0,
      0,
    );
    const layer = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length });
    const out1 = layer.forward(v1, true);
    const out2 = layer.forward(v2, true);

    const actual = {
      out1: Array.from(out1.w as number[] | Float64Array),
      out2: Array.from(out2.w as number[] | Float64Array),
    };
    expect(actual).toEqual({ out1: actual.out1, out2: actual.out1 });
  });

  // backward: gradients p - onehot(y), loss = -log(p_y)
  it.each`
    name                         | input         | yi
    ${'simple 3-class'}          | ${[1, 2, 3]}  | ${2}
    ${'uniform probabilities'}   | ${[0, 0, 0]}  | ${1}
    ${'mixed positive/negative'} | ${[1, -2, 3]} | ${0}
  `('backward() gradients and loss: $name', ({ input, yi }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: input.length });
    layer.forward(v, true);

    // compute expected p
    const amax = Math.max(...(input as number[]));
    const es = (input as number[]).map(x => Math.exp(x - amax));
    const esum = es.reduce((a, b) => a + b, 0);
    const p = es.map(e => e / esum);

    const loss = layer.backward(yi as number);
    const grad = Array.from(v.dw as number[] | Float64Array);

    const expectedGrad = p.map((pi, i) => pi - (i === (yi as number) ? 1 : 0));
    const expectedLoss = -Math.log(p[yi as number]);

    expect({ grad, loss }).toEqual({ grad: expectedGrad, loss: expectedLoss });
  });

  // backward should throw if label is missing
  it('backward() throws when y is undefined', () => {
    const v = new Vol([1, 2, 3], 0, 0);
    const layer = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    layer.forward(v, true);
    expect(() => layer.backward(undefined as unknown as number)).toThrowError('y cannot be empty');
  });

  // JSON roundtrip preserves layer config
  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new SoftmaxLayer(config);
    const json = layer.toJSON();
    const layer2 = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: 1 });
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
    const layer = new SoftmaxLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
