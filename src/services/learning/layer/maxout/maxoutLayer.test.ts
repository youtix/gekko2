import { describe, expect, it } from 'vitest';

import { MaxoutLayer } from '@services/learning/layer/maxout/maxoutLayer';
import { Vol } from '@services/learning/volume/vol';

describe('MaxoutLayer', () => {
  it.each`
    name                               | in_sx | in_sy | in_depth | group_size   | out_sx | out_sy | out_depth
    ${'1x1 depth 4 group 2'}           | ${1}  | ${1}  | ${4}     | ${2}         | ${1}   | ${1}   | ${2}
    ${'3x2 depth 5 group 2 (floor)'}   | ${3}  | ${2}  | ${5}     | ${2}         | ${3}   | ${2}   | ${2}
    ${'2x2 depth 3 default group (2)'} | ${2}  | ${2}  | ${3}     | ${undefined} | ${2}   | ${2}   | ${1}
  `('computes output shape: $name', ({ in_sx, in_sy, in_depth, group_size, out_sx, out_sy, out_depth }) => {
    const layer = new MaxoutLayer({ in_sx, in_sy, in_depth, group_size });
    expect({
      out_sx: layer.out_sx,
      out_sy: layer.out_sy,
      out_depth: layer.out_depth,
      layer_type: layer.layer_type,
    }).toEqual({ out_sx, out_sy, out_depth, layer_type: 'maxout' });
  });

  it.each`
    name                                       | input                      | group_size | expected
    ${'gs=2 simple positives/negatives'}       | ${[1, -1, 2, -2]}          | ${2}       | ${[1, 2]}
    ${'gs=3 ignores leftover channels (7->2)'} | ${[1, 2, 3, 0, -5, -6, 4]} | ${3}       | ${[3, 0]}
    ${'gs=2 all negatives'}                    | ${[-3, -1, -2, -10]}       | ${2}       | ${[-1, -2]}
  `(
    'forward() 1x1 groups max: $name',
    ({ input, group_size, expected }: { input: number[]; group_size: number; expected: number[] }) => {
      const v = new Vol(input as number[], 0, 0);
      const layer = new MaxoutLayer({ in_sx: 1, in_sy: 1, in_depth: (input as number[]).length, group_size });
      const out = layer.forward(v, true);
      expect(Array.from(out.w as number[] | Float64Array)).toEqual(expected as number[]);
    },
  );

  it('forward() 2D volume: depth-wise maxima per (x,y)', () => {
    // Volume 2x2x4, group_size=2 -> out_depth=2
    const V = new Vol(2, 2, 4, 0.0);
    // (x=0,y=0): group0 max 2 (d0=1,d1=2); group1 max 4 (d2=3,d3=4)
    V.set(0, 0, 0, 1);
    V.set(0, 0, 1, 2);
    V.set(0, 0, 2, 3);
    V.set(0, 0, 3, 4);
    // (x=1,y=0): group0 max 5 (d0=5,d1=0); group1 max 1 (d2=1,d3=-1)
    V.set(1, 0, 0, 5);
    V.set(1, 0, 1, 0);
    V.set(1, 0, 2, 1);
    V.set(1, 0, 3, -1);
    // (x=0,y=1): group0 max -1 (d0=-1,d1=-2); group1 max 100 (d2=100,d3=50)
    V.set(0, 1, 0, -1);
    V.set(0, 1, 1, -2);
    V.set(0, 1, 2, 100);
    V.set(0, 1, 3, 50);
    // (x=1,y=1): group0 max 7 (d0=7,d1=7 tie pick first); group1 max -2 (d2=-3,d3=-2)
    V.set(1, 1, 0, 7);
    V.set(1, 1, 1, 7);
    V.set(1, 1, 2, -3);
    V.set(1, 1, 3, -2);

    const layer = new MaxoutLayer({ in_sx: 2, in_sy: 2, in_depth: 4, group_size: 2 });
    const out = layer.forward(V);
    // Expected flat order: (0,0,d0,d1), (1,0,d0,d1), (0,1,d0,d1), (1,1,d0,d1)
    expect(Array.from(out.w as number[] | Float64Array)).toEqual([2, 4, 5, 1, -1, 100, 7, -2]);
  });

  it('backward() 1x1 routes grads to argmax (stable ties)', () => {
    // Two groups (gs=2): [2,2] (tie -> index 0), [1,9] (index 1)
    const input = [2, 2, 1, 9];
    const v = new Vol(input, 0, 0);
    const layer = new MaxoutLayer({ in_sx: 1, in_sy: 1, in_depth: input.length, group_size: 2 });
    const out = layer.forward(v, true);
    // upstream grads
    out.dw[0] = 5; // to first group winner (index 0)
    out.dw[1] = 7; // to second group winner (index 3)
    layer.backward();
    const expected = [5, 0, 0, 7];
    expect(Array.from(v.dw as number[] | Float64Array)).toEqual(expected);
  });

  it('backward() 2D routes grads to per-site argmax channels', () => {
    // Same construction as the 2D forward test
    const V = new Vol(2, 2, 4, 0.0);
    V.set(0, 0, 0, 1);
    V.set(0, 0, 1, 2);
    V.set(0, 0, 2, 3);
    V.set(0, 0, 3, 4);
    V.set(1, 0, 0, 5);
    V.set(1, 0, 1, 0);
    V.set(1, 0, 2, 1);
    V.set(1, 0, 3, -1);
    V.set(0, 1, 0, -1);
    V.set(0, 1, 1, -2);
    V.set(0, 1, 2, 100);
    V.set(0, 1, 3, 50);
    V.set(1, 1, 0, 7);
    V.set(1, 1, 1, 7);
    V.set(1, 1, 2, -3);
    V.set(1, 1, 3, -2);

    const layer = new MaxoutLayer({ in_sx: 2, in_sy: 2, in_depth: 4, group_size: 2 });
    const out = layer.forward(V);
    // Give distinct upstream grads to each output channel
    // Order: (0,0,d0,d1), (1,0,d0,d1), (0,1,d0,d1), (1,1,d0,d1)
    const ups = [10, 11, 12, 13, 14, 15, 16, 17];
    for (let i = 0; i < ups.length; i++) out.dw[i] = ups[i];
    layer.backward();

    // Build expected dw (length 2*2*4 = 16), routed to argmax channels:
    // (0,0): group0 winner d1 -> grad 10; group1 winner d3 -> grad 11
    // (1,0): group0 winner d0 -> grad 12; group1 winner d2 -> grad 13
    // (0,1): group0 winner d0 -> grad 14; group1 winner d2 -> grad 15
    // (1,1): group0 winner d0 (tie) -> grad 16; group1 winner d3 -> grad 17
    const expectedDw = new Array(16).fill(0);
    const idx = (x: number, y: number, d: number) => (2 * y + x) * 4 + d;
    expectedDw[idx(0, 0, 1)] = 10;
    expectedDw[idx(0, 0, 3)] = 11;
    expectedDw[idx(1, 0, 0)] = 12;
    expectedDw[idx(1, 0, 2)] = 13;
    expectedDw[idx(0, 1, 0)] = 14;
    expectedDw[idx(0, 1, 2)] = 15;
    expectedDw[idx(1, 1, 0)] = 16;
    expectedDw[idx(1, 1, 3)] = 17;

    expect(Array.from(V.dw as number[] | Float64Array)).toEqual(expectedDw);
  });

  it.each`
    name             | config
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3, group_size: 2 }}
    ${'shape 2x3x4'} | ${{ in_sx: 2, in_sy: 3, in_depth: 4, group_size: 4 }}
  `('toJSON/fromJSON: $name', ({ config }) => {
    const layer = new MaxoutLayer(config as { in_sx: number; in_sy: number; in_depth: number; group_size: number });
    const json = layer.toJSON();
    const layer2 = new MaxoutLayer({ in_sx: 1, in_sy: 1, in_depth: 2, group_size: 2 });
    layer2.fromJSON(json);
    const snapshot = {
      out_sx: layer2.out_sx,
      out_sy: layer2.out_sy,
      out_depth: layer2.out_depth,
      layer_type: layer2.layer_type,
      group_size: layer2.group_size,
    };
    expect(snapshot).toEqual({
      out_sx: json.out_sx,
      out_sy: json.out_sy,
      out_depth: json.out_depth,
      layer_type: json.layer_type,
      group_size: json.group_size,
    });
  });

  it('getParamsAndGrads returns empty array', () => {
    const layer = new MaxoutLayer({ in_sx: 1, in_sy: 1, in_depth: 3, group_size: 2 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
