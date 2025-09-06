import { describe, expect, it } from 'vitest';
import { Vol } from '../../volume/vol';
import { ConvLayer } from './convLayer';

// helper to set all filter weights deterministically
function setFilterWeights(layer: ConvLayer, filterIndex: number, weights: number[]) {
  const f = layer.filters[filterIndex];
  for (let i = 0; i < f.w.length; i++) f.w[i] = weights[i] ?? 0;
}

// helper to set bias for a given filter
function setBias(layer: ConvLayer, filterIndex: number, bias: number) {
  layer.biases.w[filterIndex] = bias;
}

describe('ConvLayer', () => {
  // forward pass: shapes and values with different padding/stride
  it.each`
    name                                | in_sx | in_sy | in_depth | data                           | sx   | sy   | stride | pad  | out_depth | filterWeights                    | biases   | expectedOutSx | expectedOutSy | expectedOutDepth | expectedOut
    ${'2x2 filter, stride1, no pad'}    | ${3}  | ${3}  | ${1}     | ${[1, 2, 3, 4, 5, 6, 7, 8, 9]} | ${2} | ${2} | ${1}   | ${0} | ${1}      | ${[[1, 0, 0, -1]]}               | ${[0]}   | ${2}          | ${2}          | ${1}             | ${[-4, -4, -4, -4]}
    ${'3x3 filter, stride1, pad1 ones'} | ${3}  | ${3}  | ${1}     | ${[1, 2, 3, 4, 5, 6, 7, 8, 9]} | ${3} | ${3} | ${1}   | ${1} | ${1}      | ${[[1, 1, 1, 1, 1, 1, 1, 1, 1]]} | ${[0]}   | ${3}          | ${3}          | ${1}             | ${[12, 21, 16, 27, 45, 33, 24, 39, 28]}
    ${'bias added to output'}           | ${3}  | ${3}  | ${1}     | ${[1, 2, 3, 4, 5, 6, 7, 8, 9]} | ${2} | ${2} | ${1}   | ${0} | ${1}      | ${[[1, 0, 0, -1]]}               | ${[1.5]} | ${2}          | ${2}          | ${1}             | ${[-2.5, -2.5, -2.5, -2.5]}
  `(
    'forward() $name',
    ({
      in_sx,
      in_sy,
      in_depth,
      data,
      sx,
      sy,
      stride,
      pad,
      out_depth,
      filterWeights,
      biases,
      expectedOutSx,
      expectedOutSy,
      expectedOutDepth,
      expectedOut,
    }) => {
      // construct layer and deterministically set weights/biases
      const layer = new ConvLayer({
        in_sx,
        in_sy,
        in_depth,
        sx,
        sy,
        stride,
        pad,
        filters: out_depth,
        bias_pref: 0,
        l1_decay_mul: 0,
        l2_decay_mul: 0,
      });
      (filterWeights as number[][]).forEach((w, i) => setFilterWeights(layer, i, w));
      (biases as number[]).forEach((b, i) => setBias(layer, i, b));

      // input volume
      const v = new Vol(in_sx, in_sy, in_depth, 0.0);
      const w = v.w as number[] | Float64Array;
      (data as number[]).forEach((val, i) => {
        w[i] = val;
      });

      // forward
      const out = layer.forward(v, true);

      const snapshot = {
        out_sx: layer.out_sx,
        out_sy: layer.out_sy,
        out_depth: layer.out_depth,
        out: Array.from(out.w as number[] | Float64Array),
      };
      expect(snapshot).toEqual({
        out_sx: expectedOutSx as number,
        out_sy: expectedOutSy as number,
        out_depth: expectedOutDepth as number,
        out: expectedOut as number[],
      });
    },
  );

  // backward pass: gradients wrt input, weights, and bias for simple case
  it('backward() gradients match manual conv sums', () => {
    const in_sx = 3;
    const in_sy = 3;
    const in_depth = 1;
    const data = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const layer = new ConvLayer({ in_sx, in_sy, in_depth, sx: 2, sy: 2, stride: 1, pad: 0, filters: 1, bias_pref: 0 });
    setFilterWeights(layer, 0, [1, 0, 0, -1]);
    setBias(layer, 0, 0);

    const v = new Vol(in_sx, in_sy, in_depth, 0.0);
    const vw = v.w as number[] | Float64Array;
    data.forEach((val, i) => {
      vw[i] = val;
    });

    const out = layer.forward(v, true);
    // upstream gradients = 1 for every output position
    const outdw = out.dw as number[] | Float64Array;
    for (let i = 0; i < outdw.length; i++) outdw[i] = 1;
    layer.backward();

    const snapshot = {
      inputDw: Array.from(v.dw as number[] | Float64Array),
      filterDw: Array.from(layer.filters[0].dw as number[] | Float64Array),
      biasDw: layer.biases.dw[0],
    };
    expect(snapshot).toEqual({
      // expected input gradient flattened row-major
      inputDw: [1, 1, 0, 1, 0, -1, 0, -1, -1],
      // expected weight gradients: sums over corresponding receptive-field positions
      filterDw: [12, 16, 24, 28],
      biasDw: 4, // one per output position (2x2)
    });
  });

  // JSON roundtrip preserves configuration and parameters
  it.each`
    name                  | cfg
    ${'3x3x1, 2 filters'} | ${{ in_sx: 3, in_sy: 3, in_depth: 1, sx: 2, sy: 2, stride: 1, pad: 0, filters: 2, bias_pref: 0 }}
  `('toJSON/fromJSON $name', ({ cfg }) => {
    const layer = new ConvLayer(cfg as any);
    // set deterministic params
    setFilterWeights(layer, 0, [1, 0, 0, -1]);
    setFilterWeights(layer, 1, [0.5, -0.5, -0.5, 0.5]);
    setBias(layer, 0, 0.25);
    setBias(layer, 1, -0.75);

    const json = layer.toJSON();

    const layer2 = new ConvLayer({ in_sx: 1, in_sy: 1, in_depth: 1, sx: 1, filters: 1 });
    layer2.fromJSON(json);

    // check shapes and a quick forward equality on same input
    const v = new Vol(3, 3, 1, 0.0);
    const vw = v.w as number[] | Float64Array;
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((val, i) => (vw[i] = val));
    const out1 = layer.forward(v, true);
    const out2 = layer2.forward(v, true);

    const snapshot = {
      dims: [layer2.out_sx, layer2.out_sy, layer2.out_depth],
      equalOut: Array.from(out1.w as any),
      equalOut2: Array.from(out2.w as any),
    };
    expect(snapshot).toEqual({
      dims: [json.out_sx, json.out_sy, json.out_depth],
      equalOut: Array.from(out1.w as any),
      equalOut2: Array.from(out1.w as any),
    });
  });

  // parameters and grads exposure
  it('getParamsAndGrads exposes filters and biases', () => {
    const layer = new ConvLayer({
      in_sx: 4,
      in_sy: 4,
      in_depth: 3,
      sx: 3,
      sy: 3,
      stride: 1,
      pad: 1,
      filters: 2,
      bias_pref: 0.1,
      l1_decay_mul: 0.2,
      l2_decay_mul: 0.3,
    });
    const pgs = layer.getParamsAndGrads();
    const snapshot = {
      count: pgs.length,
      filterParamLens: [pgs[0].params.length, pgs[1].params.length],
      biasLen: pgs[2].params.length,
      l1l2First: [pgs[0].l1_decay_mul, pgs[0].l2_decay_mul],
      l1l2Bias: [pgs[2].l1_decay_mul, pgs[2].l2_decay_mul],
    };
    const expectedFilterSize = 3 * 3 * 3; // sx * sy * in_depth
    expect(snapshot).toEqual({
      count: 3, // 2 filters + 1 bias vol
      filterParamLens: [expectedFilterSize, expectedFilterSize],
      biasLen: 2, // one bias per filter
      l1l2First: [0.2, 0.3],
      l1l2Bias: [0, 0],
    });
  });
});
