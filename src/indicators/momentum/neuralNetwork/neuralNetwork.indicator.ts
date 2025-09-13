import * as tf from '@tensorflow/tfjs-node';
tf.setBackend('tensorflow');

import { SMMA } from '@indicators/movingAverages/smma/smma.indicator';
import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { ohlc4 } from '@utils/candle/candle.utils';

import { Indicator } from '../../indicator';

import {
  CLIP,
  EPSILON,
  REHEARSE_INTERVAL,
  REHEARSE_TRAINING_EPOCHS,
  REHEARSE_WINDOW_SIZE,
  TRAINING_EPOCHS,
} from './neuronalNetwork.const';

type LayerConfig = { name: keyof typeof tf.layers; [key: string]: unknown };

function assertValidLayers(
  layers: LayerConfig[],
): asserts layers is [LayerConfig & { inputShape: number[] }, ...LayerConfig[]] {
  if (!Array.isArray(layers) || layers.length === 0) {
    throw new Error('layers must be defined');
  }

  layers.forEach(layer => {
    if (!(layer.name in tf.layers)) {
      throw new Error(`Layer name "${layer.name}" is not valid`);
    }
  });

  const inputShape = (layers[0] as Record<string, unknown>).inputShape;
  if (!Array.isArray(inputShape) || inputShape.length === 0) {
    throw new Error('First layer must define inputShape');
  }
}

export class NeuralNetwork extends Indicator<'neuralNetwork'> {
  private smma: SMMA;
  private buffer: RingBuffer<number>;
  private trainCache: RingBuffer<number>;
  private lastSmoothRes: Nullable<number>;
  private tick: number;
  private inputDepth: number;
  private isRehearse: boolean;

  private model: tf.Sequential;
  private optimizer: tf.Optimizer;
  private epochs: number;

  constructor({
    layers = [],
    training,
    smoothPeriod = 5,
    isRehearse = false,
  }: IndicatorRegistry['neuralNetwork']['input'] = {}) {
    super('neuralNetwork', null);

    assertValidLayers(layers);
    this.inputDepth = layers[0].inputShape[0];

    this.smma = new SMMA({ period: smoothPeriod });
    this.buffer = new RingBuffer(this.inputDepth + 1);
    this.trainCache = new RingBuffer(Math.max(this.inputDepth * 3, REHEARSE_WINDOW_SIZE + this.inputDepth));
    this.lastSmoothRes = null;
    this.isRehearse = isRehearse;
    this.tick = 0;

    const trainingDefaults = {
      learningRate: 0.001,
      batchSize: 1,
      epochs: TRAINING_EPOCHS,
    };
    const trainingCfg = { ...trainingDefaults, ...(training ?? {}) };

    this.model = tf.sequential();
    layers.forEach(({ name, ...cfg }) => {
      const layerFn = (tf.layers as unknown as Record<keyof typeof tf.layers, (cfg: unknown) => tf.layers.Layer>)[name];
      this.model.add(layerFn(cfg));
    });

    this.optimizer = tf.train.adam(trainingCfg.learningRate);
    this.epochs = trainingCfg.epochs;
  }

  public onNewCandle(candle: Candle) {
    this.smma.onNewCandle({ close: ohlc4(candle) } as Candle);
    const smmaRes = this.smma.getResult();

    if (Number.isFinite(smmaRes) && Number.isFinite(this.lastSmoothRes)) {
      const rawRt = Math.log(smmaRes! / (this.lastSmoothRes! + EPSILON));
      const r_t = Number.isFinite(rawRt) ? this.clip(rawRt, -CLIP, CLIP) : 0;
      this.buffer.push(r_t);
      this.trainCache.push(r_t);
      this.learn();
      this.result = this.predictCandle(smmaRes!) ?? null;
    }

    this.lastSmoothRes = smmaRes;

    if (this.isRehearse) {
      this.tick++;
      if (this.tick >= REHEARSE_INTERVAL) {
        this.rehearse(REHEARSE_WINDOW_SIZE, REHEARSE_TRAINING_EPOCHS);
        this.tick = 0;
      }
    }
  }

  public getResult() {
    return this.result;
  }

  private learn() {
    if (!this.buffer.isFull()) return;

    const buf = this.buffer.toArray();
    const x = buf.slice(0, -1);
    const y = buf[buf.length - 1];

    for (let i = 0; i < this.epochs; i++) {
      tf.tidy(() => {
        const xs = tf.tensor2d([x]);
        const ys = tf.tensor2d([[y]]);
        this.optimizer.minimize(() => {
          const preds = this.model.predict(xs) as tf.Tensor;
          return preds.sub(ys).square().mean();
        });
      });
    }
  }

  private predictCandle(currentSmma: number) {
    if (!this.buffer.isFull() || !Number.isFinite(currentSmma)) return;

    const x = this.buffer.toArray().slice(1);
    const r_next = tf.tidy(() => {
      const xs = tf.tensor2d([x]);
      const out = this.model.predict(xs) as tf.Tensor;
      return out.dataSync()[0];
    });

    if (!Number.isFinite(r_next)) return;
    return currentSmma * Math.exp(r_next);
  }

  private clip(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
  }

  private rehearse(span: number, epochs: number) {
    const all = this.trainCache.toArray();
    if (all.length < this.inputDepth + 1) return;

    const start = Math.max(0, all.length - (span + this.inputDepth));
    const window = all.slice(start);

    for (let i = this.inputDepth; i < window.length; i++) {
      const x = window.slice(i - this.inputDepth, i);
      const y = window[i];
      for (let e = 0; e < epochs; e++) {
        tf.tidy(() => {
          const xs = tf.tensor2d([x]);
          const ys = tf.tensor2d([[y]]);
          this.optimizer.minimize(() => {
            const preds = this.model.predict(xs) as tf.Tensor;
            return preds.sub(ys).square().mean();
          });
        });
      }
    }
  }
}
