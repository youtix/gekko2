import { describe, expect, it } from 'vitest';

import { Vol } from '../../volume/vol';
import { PoolLayer } from './poolLayer';

describe('PoolLayer', () => {
  it.each`
    sx   | sy   | stride | pad  | in_sx | in_sy | in_depth | out_sx | out_sy | out_depth
    ${2} | ${2} | ${2}   | ${0} | ${4}  | ${4}  | ${1}     | ${2}   | ${2}   | ${1}
    ${3} | ${3} | ${1}   | ${0} | ${5}  | ${4}  | ${2}     | ${3}   | ${2}   | ${2}
    ${2} | ${2} | ${2}   | ${1} | ${4}  | ${4}  | ${3}     | ${3}   | ${3}   | ${3}
  `(
    'computes output shape for sx=${sx}, sy=${sy}, stride=${stride}, pad=${pad}',
    ({ sx, sy, stride, pad, in_sx, in_sy, in_depth, out_sx, out_sy, out_depth }) => {
      const layer = new PoolLayer({ sx, sy, stride, pad, in_sx, in_sy, in_depth });
      expect({
        out_sx: layer.out_sx,
        out_sy: layer.out_sy,
        out_depth: layer.out_depth,
        layer_type: layer.layer_type,
      }).toEqual({ out_sx, out_sy, out_depth, layer_type: 'pool' });
    },
  );

  it('forward: max-pools a 4x4 single-channel volume (2x2 stride 2)', () => {
    const V = new Vol(4, 4, 1, 0.0);
    // Fill with 0..15 row-major
    let val = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        V.set(x, y, 0, val++);
      }
    }
    const layer = new PoolLayer({ sx: 2, sy: 2, stride: 2, pad: 0, in_sx: 4, in_sy: 4, in_depth: 1 });
    const out = layer.forward(V);
    // Expected maxima for blocks: [5,7; 13,15] in linear order (x fastest)
    expect(Array.from(out.w)).toEqual([5, 7, 13, 15]);
  });

  it('backward: routes gradients only to argmax positions (non-overlap)', () => {
    const V = new Vol(4, 4, 1, 0.0);
    // Fill with 0..15 row-major
    let val = 0;
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++) {
        V.set(x, y, 0, val++);
      }
    }
    const layer = new PoolLayer({ sx: 2, sy: 2, stride: 2, pad: 0, in_sx: 4, in_sy: 4, in_depth: 1 });
    const out = layer.forward(V);
    // Set chain gradients of all outputs to 1
    for (let ay = 0; ay < layer.out_sy; ay++) {
      for (let ax = 0; ax < layer.out_sx; ax++) {
        out.set_grad(ax, ay, 0, 1);
      }
    }
    layer.backward();

    const expectedDw = new Array(16).fill(0);
    // Argmax positions for each 2x2 window are (1,1), (3,1), (1,3), (3,3)
    expectedDw[(4 * 1 + 1) * 1 + 0] = 1; // (1,1)
    expectedDw[(4 * 1 + 3) * 1 + 0] = 1; // (3,1)
    expectedDw[(4 * 3 + 1) * 1 + 0] = 1; // (1,3)
    expectedDw[(4 * 3 + 3) * 1 + 0] = 1; // (3,3)

    expect(Array.from(V.dw)).toEqual(expectedDw);
  });

  it('backward: accumulates overlapping gradients at shared argmax (stride 1)', () => {
    // 3x3 volume with a clear global max at center
    const V = new Vol(3, 3, 1, 0.0);
    const vals = [0, 1, 2, 3, 100, 5, 6, 7, 8];
    let i = 0;
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        V.set(x, y, 0, vals[i++]);
      }
    }
    const layer = new PoolLayer({ sx: 2, sy: 2, stride: 1, pad: 0, in_sx: 3, in_sy: 3, in_depth: 1 });
    const out = layer.forward(V);

    // There are 4 outputs (2x2). Set all chain grads to 1.
    for (let ay = 0; ay < layer.out_sy; ay++) {
      for (let ax = 0; ax < layer.out_sx; ax++) {
        out.set_grad(ax, ay, 0, 1);
      }
    }
    layer.backward();

    const expectedDw = new Array(9).fill(0);
    // All 4 outputs should route gradient to center (1,1)
    expectedDw[(3 * 1 + 1) * 1 + 0] = 4;

    expect(Array.from(V.dw)).toEqual(expectedDw);
  });
});
