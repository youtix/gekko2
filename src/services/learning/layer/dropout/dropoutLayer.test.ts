import { afterEach, describe, expect, it, vi } from 'vitest';
import { Vol } from '../../volume/vol';
import { DropoutLayer } from './dropoutLayer';

describe('DropoutLayer', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // helper to mock Math.random with a deterministic sequence
  function mockRandom(sequence: number[]) {
    let i = 0;
    return vi.spyOn(Math, 'random').mockImplementation(() => {
      const val = sequence[i] ?? sequence[sequence.length - 1] ?? 0;
      i++;
      return val;
    });
  }

  // forward (training): drops elements where random < drop_prob, returns a clone
  it.each`
    name                             | drop_prob | input              | randoms                      | expected
    ${'50% style mask'}              | ${0.4}    | ${[1, 2, 3, 4, 5]} | ${[0.1, 0.9, 0.3, 0.7, 0.4]} | ${{ out: [0, 2, 0, 4, 5], dropped: [1, 0, 1, 0, 0] }}
    ${'high drop prob, short input'} | ${0.8}    | ${[1, 2, -1]}      | ${[0.9, 0.9, 0.3]}           | ${{ out: [1, 2, 0], dropped: [0, 0, 1] }}
  `('forward() training: $name', ({ drop_prob, input, randoms, expected }) => {
    const layer = new DropoutLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length, drop_prob });
    const v = new Vol(input as number[], 0, 0);
    const stop = mockRandom(randoms as number[]);
    const out = layer.forward(v, true);
    stop.mockRestore();

    const snapshot = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
      dropped: Array.from(layer.dropped),
    };
    expect(snapshot).toEqual({
      sameObject: false,
      out: (expected as any).out,
      input: input as number[],
      dropped: (expected as any).dropped,
    });
  });

  // forward (prediction): scales activations by drop_prob (current implementation), returns clone
  it.each`
    name                         | drop_prob | input              | is_training  | expected
    ${'explicit prediction'}     | ${0.25}   | ${[1, 2, -4]}      | ${false}     | ${[0.25, 0.5, -1]}
    ${'default prediction mode'} | ${0.5}    | ${[3, -1, 0, 2.5]} | ${undefined} | ${[1.5, -0.5, 0, 1.25]}
  `('forward() prediction: $name', ({ drop_prob, input, is_training, expected }) => {
    const layer = new DropoutLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length, drop_prob });
    const v = new Vol(input as number[], 0, 0);
    const out = layer.forward(v, is_training as any);

    const snapshot = {
      sameObject: out === v,
      out: Array.from(out.w as number[] | Float64Array),
      input: Array.from(v.w as number[] | Float64Array),
    };
    expect(snapshot).toEqual({ sameObject: false, out: expected as number[], input: input as number[] });
  });

  // backward: copies upstream grad only for non-dropped positions
  it('backward() respects dropped mask', () => {
    const input = [1, 2, 3, 4, 5];
    const randoms = [0.1, 0.9, 0.3, 0.7, 0.4]; // with drop_prob=0.4 -> drop at 0 and 2
    const upstream = [10, 20, 30, 40, 50];
    const layer = new DropoutLayer({ in_sx: 1, in_sy: 1, in_depth: input.length, drop_prob: 0.4 });
    const v = new Vol(input, 0, 0);
    const stop = mockRandom(randoms);
    const out = layer.forward(v, true);
    stop.mockRestore();

    const outdw = out.dw as number[] | Float64Array;
    upstream.forEach((g, i) => {
      outdw[i] = g;
    });
    layer.backward();

    const actual = Array.from(v.dw as number[] | Float64Array);
    expect(actual).toEqual([0, 20, 0, 40, 50]);
  });

  // JSON roundtrip preserves configuration
  it.each`
    name             | cfg
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4, drop_prob: 0.2 }}
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, drop_prob: 0.75 }}
  `('toJSON/fromJSON: $name', ({ cfg }) => {
    const layer = new DropoutLayer(cfg as any);
    const json = layer.toJSON();
    const layer2 = new DropoutLayer({ in_sx: 1, in_sy: 1, in_depth: 1, drop_prob: 0.5 });
    layer2.fromJSON(json);
    const snapshot = {
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      drop_prob: layer2.drop_prob,
      layer_type: layer2.layer_type,
    };
    expect(snapshot).toEqual({
      out_sx: json.out_sx,
      out_sy: json.out_sy,
      out_depth: json.out_depth,
      drop_prob: json.drop_prob,
      layer_type: 'dropout',
    });
  });

  // no trainable parameters
  it('getParamsAndGrads returns empty array', () => {
    const layer = new DropoutLayer({ in_sx: 1, in_sy: 1, in_depth: 3, drop_prob: 0.5 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
