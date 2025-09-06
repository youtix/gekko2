import { FullyConnLayer } from '@services/learning/layer/fullyConn/fullyConnLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

// helper to avoid -0 in snapshots
const nz = (x: number) => (Object.is(x, -0) ? 0 : x);

describe('FullyConnLayer', () => {
  // forward: computes dot products plus biases for each neuron
  it.each`
    name                    | input            | weights                                          | biases         | dims
    ${'1x1x3 => 2 neurons'} | ${[1, 2, 3]}     | ${[[1, 2, 3], [0, -1, 1]]}                       | ${[0.5, -0.5]} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, filters: 2 }}
    ${'1x1x4 => 3 neurons'} | ${[0, -1, 2, 4]} | ${[[1, 0, 1, 0], [2, 2, -1, 0.5], [0, 0, 0, 1]]} | ${[1, 0, -1]}  | ${{ in_sx: 1, in_sy: 1, in_depth: 4, filters: 3 }}
  `('forward() affine transform: $name', ({ input, weights, biases, dims }) => {
    const v = new Vol(input as number[], 0, 0);
    const layer = new FullyConnLayer(dims as { in_sx: number; in_sy: number; in_depth: number; filters: number });
    // override random init with deterministic weights/biases
    (weights as number[][]).forEach((w, i) => {
      const wi = layer.filters[i].w as number[] | Float64Array;
      for (let d = 0; d < w.length; d++) wi[d] = w[d];
    });
    (biases as number[]).forEach((b, i) => {
      (layer.biases.w as number[] | Float64Array)[i] = b;
    });

    const out = layer.forward(v, true);
    const outArr = Array.from(out.w as number[] | Float64Array);
    // expected y_i = dot(w_i, input) + b_i
    const expected = (weights as number[][]).map(
      (wi, i) => wi.reduce((s, x, k) => s + x * (input as number[])[k], 0) + (biases as number[])[i],
    );

    const snapshot = {
      outValues: outArr,
      outShape: { sx: out.sx, sy: out.sy, depth: out.depth },
      layerShape: { out_sx: layer.out_sx, out_sy: layer.out_sy, out_depth: layer.out_depth },
      layerType: layer.layer_type,
    };
    expect(snapshot).toEqual({
      outValues: expected,
      outShape: { sx: 1, sy: 1, depth: (dims as any).filters },
      layerShape: { out_sx: 1, out_sy: 1, out_depth: (dims as any).filters },
      layerType: 'fc',
    });
  });

  // backward: gradients wrt input, weights, and biases
  it.each`
    name                     | input            | weights                                          | biases       | upstream
    ${'2 neurons, 3 inputs'} | ${[1, 2, 3]}     | ${[[1, 2, 3], [0, -1, 1]]}                       | ${[0, 0]}    | ${[0.1, -0.2]}
    ${'3 neurons, 4 inputs'} | ${[0, -1, 2, 4]} | ${[[1, 0, 1, 0], [2, 2, -1, 0.5], [0, 0, 0, 1]]} | ${[0, 0, 0]} | ${[1, 0.5, -0.5]}
  `('backward() gradients: $name', ({ input, weights, biases, upstream }) => {
    const v = new Vol(input as number[], 0, 0);
    const dims = { in_sx: 1, in_sy: 1, in_depth: (input as number[]).length, filters: (weights as number[][]).length };
    const layer = new FullyConnLayer(dims);
    // set deterministic weights/biases
    (weights as number[][]).forEach((w, i) => {
      const wi = layer.filters[i].w as number[] | Float64Array;
      for (let d = 0; d < w.length; d++) wi[d] = w[d];
    });
    (biases as number[]).forEach((b, i) => {
      (layer.biases.w as number[] | Float64Array)[i] = b;
    });

    const out = layer.forward(v, true);
    // write upstream gradient into out.dw
    const outdw = out.dw as number[] | Float64Array;
    (upstream as number[]).forEach((g, i) => (outdw[i] = g));
    layer.backward();

    // expected grads
    const expectedInputGrad = (input as number[]).map((_, d) =>
      (weights as number[][]).reduce((sum, wi, i) => sum + wi[d] * (upstream as number[])[i], 0),
    );
    const expectedFilterGrads = (weights as number[][]).map(() => (input as number[]).map(x => x));
    expectedFilterGrads.forEach((g, i) => {
      for (let d = 0; d < g.length; d++) g[d] = nz(g[d] * (upstream as number[])[i]);
    });
    const expectedBiasGrads = upstream as number[];

    const snapshot = {
      inputGrad: Array.from(v.dw as number[] | Float64Array),
      filterGrads: (layer.filters as Vol[]).map(f => Array.from(f.dw as number[] | Float64Array)),
      biasGrads: Array.from(layer.biases.dw as number[] | Float64Array),
    };
    expect(snapshot).toEqual({
      inputGrad: expectedInputGrad,
      filterGrads: expectedFilterGrads,
      biasGrads: expectedBiasGrads,
    });
  });

  // params/grads: correct references and decay multipliers
  it('getParamsAndGrads returns params with correct refs and decays', () => {
    const layer = new FullyConnLayer({
      in_sx: 1,
      in_sy: 1,
      in_depth: 3,
      filters: 2,
      l1_decay_mul: 0.11,
      l2_decay_mul: 0.22,
    });
    const pgs = layer.getParamsAndGrads();
    const refs = pgs.map(pg => ({
      paramsRef: pg.params === (pg === pgs[pgs.length - 1] ? layer.biases.w : layer.filters[pgs.indexOf(pg)].w),
      gradsRef: pg.grads === (pg === pgs[pgs.length - 1] ? layer.biases.dw : layer.filters[pgs.indexOf(pg)].dw),
      l1: pg.l1_decay_mul,
      l2: pg.l2_decay_mul,
    }));
    const snapshot = {
      length: pgs.length,
      refs,
    };
    expect(snapshot).toEqual({
      length: 3,
      refs: [
        { paramsRef: true, gradsRef: true, l1: 0.11, l2: 0.22 },
        { paramsRef: true, gradsRef: true, l1: 0.11, l2: 0.22 },
        { paramsRef: true, gradsRef: true, l1: 0.0, l2: 0.0 },
      ],
    });
  });

  // JSON roundtrip preserves config and parameters
  it.each`
    name                     | dims                                               | weights                                          | biases         | l1     | l2
    ${'2 neurons, 3 inputs'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, filters: 2 }} | ${[[1, 2, 3], [0, -1, 1]]}                       | ${[0.5, -0.5]} | ${0}   | ${1}
    ${'3 neurons, 4 inputs'} | ${{ in_sx: 1, in_sy: 1, in_depth: 4, filters: 3 }} | ${[[1, 0, 1, 0], [2, 2, -1, 0.5], [0, 0, 0, 1]]} | ${[1, 0, -1]}  | ${0.3} | ${0.7}
  `('toJSON/fromJSON: $name', ({ dims, weights, biases, l1, l2 }) => {
    const layer = new FullyConnLayer({
      ...(dims as any),
      l1_decay_mul: l1 as number,
      l2_decay_mul: l2 as number,
      bias_pref: 0,
    });
    // set deterministic weights/biases
    (weights as number[][]).forEach((w, i) => {
      const wi = layer.filters[i].w as number[] | Float64Array;
      for (let d = 0; d < w.length; d++) wi[d] = w[d];
    });
    (biases as number[]).forEach((b, i) => {
      (layer.biases.w as number[] | Float64Array)[i] = b;
    });

    const json = layer.toJSON();
    const layer2 = new FullyConnLayer({
      in_sx: 1,
      in_sy: 1,
      in_depth: (dims as any).in_depth,
      filters: (dims as any).filters,
    });
    layer2.fromJSON(json);

    const snapshot = {
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      layer_type: layer2.layer_type,
      num_inputs: layer2.num_inputs,
      l1_decay_mul: layer2.l1_decay_mul,
      l2_decay_mul: layer2.l2_decay_mul,
      filters: layer2.filters.map(f => Array.from(f.w as number[] | Float64Array)),
      biases: Array.from(layer2.biases.w as number[] | Float64Array),
    };
    expect(snapshot).toEqual({
      out_sx: 1,
      out_sy: 1,
      out_depth: (dims as any).filters,
      layer_type: 'fc',
      num_inputs: (dims as any).in_sx * (dims as any).in_sy * (dims as any).in_depth,
      l1_decay_mul: l1 as number,
      l2_decay_mul: l2 as number,
      filters: weights as number[][],
      biases: biases as number[],
    });
  });
});
