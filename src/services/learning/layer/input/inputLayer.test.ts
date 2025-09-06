import { InputLayer } from '@services/learning/layer/input/inputLayer';
import { Vol } from '@services/learning/volume/vol';
import { describe, expect, it } from 'vitest';

describe('InputLayer', () => {
  // forward: identity pass-through, preserves reference and values
  it.each`
    name                         | makeVol                            | opt
    ${'1x1x3 from array + in_*'} | ${() => new Vol([1, -2, 3], 0, 0)} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'2x2x2 const + out_*'}     | ${() => new Vol(2, 2, 2, 0.5)}     | ${{ out_sx: 2, out_sy: 2, out_depth: 2 }}
    ${'3x1x4 const + in_*'}      | ${() => new Vol(3, 1, 4, -1.25)}   | ${{ in_sx: 3, in_sy: 1, in_depth: 4 }}
  `('forward() identity: $name', ({ makeVol, opt }) => {
    const v = (makeVol as () => Vol)();
    const layer = new InputLayer(opt as any);
    const out = layer.forward(v, true);

    const snapshot = {
      sameObject: out === v,
      outValues: Array.from(out.w as number[] | Float64Array),
      inValues: Array.from(v.w as number[] | Float64Array),
      volShape: { sx: out.sx, sy: out.sy, depth: out.depth },
      layerShape: { out_sx: layer.out_sx, out_sy: layer.out_sy, out_depth: layer.out_depth },
      layerType: layer.layer_type,
    };

    const expectShape = {
      out_sx: (opt as any).out_sx ?? (opt as any).in_sx,
      out_sy: (opt as any).out_sy ?? (opt as any).in_sy,
      out_depth: (opt as any).out_depth ?? (opt as any).in_depth,
    };
    expect(snapshot).toEqual({
      sameObject: true,
      outValues: snapshot.inValues,
      inValues: snapshot.inValues,
      volShape: { sx: v.sx, sy: v.sy, depth: v.depth },
      layerShape: expectShape,
      layerType: 'input',
    });
  });

  // backward: no-op, leaves gradients untouched
  it.each`
    name                    | makeVol
    ${'1x1x4 from array'}   | ${() => new Vol([0.1, 0.2, 0.3, 0.4], 0, 0)}
    ${'2x3x1 const volume'} | ${() => new Vol(2, 3, 1, 0)}
  `('backward() no-op: $name', ({ makeVol }) => {
    const v = (makeVol as () => Vol)();
    const layer = new InputLayer({ in_sx: v.sx, in_sy: v.sy, in_depth: v.depth });
    const out = layer.forward(v, true);

    // write some upstream gradient into out.dw (same object as v.dw)
    const up = Array.from({ length: out.w.length }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const outdw = out.dw as number[] | Float64Array;
    up.forEach((g, i) => {
      outdw[i] = g;
    });
    layer.backward();

    const snapshot = {
      sameObject: out === v,
      gradAfterBackward: Array.from(v.dw as number[] | Float64Array),
    };
    expect(snapshot).toEqual({ sameObject: true, gradAfterBackward: up });
  });

  // JSON roundtrip preserves config
  it.each`
    name             | cfg
    ${'shape 1x1x3'} | ${{ in_sx: 1, in_sy: 1, in_depth: 3 }}
    ${'shape 2x3x4'} | ${{ out_sx: 2, out_sy: 3, out_depth: 4 }}
  `('toJSON/fromJSON: $name', ({ cfg }) => {
    const layer = new InputLayer(cfg as any);
    const json = layer.toJSON();
    const layer2 = new InputLayer();
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
      layer_type: 'input',
    });
  });

  // params/grads: no trainable parameters
  it('getParamsAndGrads returns empty array', () => {
    const layer = new InputLayer({ in_sx: 1, in_sy: 1, in_depth: 3 });
    expect(layer.getParamsAndGrads()).toEqual([]);
  });
});
