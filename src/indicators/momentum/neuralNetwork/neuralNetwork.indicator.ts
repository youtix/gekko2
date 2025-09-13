import * as tf from '@tensorflow/tfjs-node';
await tf.setBackend('tensorflow');
await tf.ready();

import { SMMA } from '@indicators/movingAverages/smma/smma.indicator';
import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { ohlc4 } from '@utils/candle/candle.utils';

import { Indicator } from '../../indicator';

import { warning } from '@services/logger';
import { CLIP, EPSILON } from './neuralNetwork.const';
import { LayerConfig, TrainingConfig } from './neuralNetwork.types';

export class NeuralNetwork extends Indicator<'neuralNetwork'> {
  private smma: SMMA;
  private buffer: RingBuffer<number>;
  private trainingBuffer: RingBuffer<number>;
  private lastSmoothRes: Nullable<number>;
  private tick: number;
  private inputDepth: number;

  private model: tf.Sequential;
  private optimizer: tf.Optimizer;
  private training: TrainingConfig;

  constructor({
    inputDepth = 1,
    layers = [],
    training,
    smoothPeriod = 5,
  }: IndicatorRegistry['neuralNetwork']['input'] = {}) {
    super('neuralNetwork', null);

    this.assertValidLayers(layers);
    this.assertValidTraining(training);

    this.inputDepth = inputDepth;
    this.smma = new SMMA({ period: smoothPeriod });
    this.buffer = new RingBuffer(this.inputDepth + 1);
    this.trainingBuffer = new RingBuffer(this.inputDepth * 5);
    this.lastSmoothRes = null;
    this.tick = 0;

    this.model = tf.sequential();
    layers.forEach(({ name, ...cfg }) => {
      // @ts-expect-error Complex typescript error
      this.model.add(tf.layers[name](cfg));
    });

    // @ts-expect-error Complex typescript error
    this.optimizer = tf.train[training.optimizerName](training.learningRate);
    this.model.compile({ optimizer: this.optimizer, loss: training.loss });
    this.training = training;
  }

  public async onNewCandle(candle: Candle) {
    this.smma.onNewCandle({ close: ohlc4(candle) } as Candle);
    const smmaRes = this.smma.getResult();

    if (Number.isFinite(smmaRes) && Number.isFinite(this.lastSmoothRes)) {
      const rawRt = Math.log((smmaRes! + EPSILON) / (this.lastSmoothRes! + EPSILON));
      const r_t = Number.isFinite(rawRt) ? this.clip(rawRt, -CLIP, CLIP) : 0;
      this.buffer.push(r_t);
      this.trainingBuffer.push(r_t);
      this.result = (await this.predictCandle(smmaRes!)) ?? null;
    }

    this.tick++;
    if (this.tick >= this.training.interval) {
      this.train();
      this.tick = 0;
    }

    this.lastSmoothRes = smmaRes;
  }

  public getResult() {
    return this.result;
  }

  private async train() {
    if (!this.trainingBuffer.isFull()) return;

    // Prepare training data efficiently using typed arrays
    const data = this.trainingBuffer.toArray();
    const depth = this.inputDepth;
    const total = data.length;
    if (total <= depth) return;

    const samples = total - depth; // number of (x,y) pairs
    const xsArr = new Float32Array(samples * depth);
    const ysArr = new Float32Array(samples);

    // Fill feature matrix (rows: samples, cols: depth) and target vector
    for (let i = 0; i < samples; i++) {
      const base = i * depth;
      for (let j = 0; j < depth; j++) {
        xsArr[base + j] = data[i + j];
      }
      ysArr[i] = data[i + depth];
    }

    const xs = tf.tensor2d(xsArr, [samples, depth]);
    const ys = tf.tensor2d(ysArr, [samples, 1]);

    try {
      await this.model.fit(xs, ys, {
        epochs: this.training.epochs,
        batchSize: this.training.batchSize,
        shuffle: false,
        verbose: this.training.verbose,
      });
    } catch {
      warning('indicator', '[NeuralNetwork] model failed during training');
    } finally {
      xs.dispose();
      ys.dispose();
    }
  }

  private async predictCandle(currentSmma: number) {
    if (!this.buffer.isFull() || !Number.isFinite(currentSmma)) return;

    const x = this.buffer.toArray().slice(1);
    const out = tf.tidy(() => {
      const xs = tf.tensor2d([x]);
      return this.model.predict(xs) as tf.Tensor;
    });

    try {
      const data = await out.data();
      const r_next = data[0];
      if (!Number.isFinite(r_next)) return;
      return currentSmma * Math.exp(r_next);
    } finally {
      out.dispose();
    }
  }

  private clip(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
  }

  private assertValidLayers(layers: LayerConfig[]): asserts layers is LayerConfig[] {
    if (!Array.isArray(layers) || layers.length === 0) {
      throw new Error('layers must be defined');
    }

    layers.forEach(layer => {
      if (!(layer.name in tf.layers)) {
        throw new Error(`Layer name "${layer.name}" is not valid`);
      }
    });
  }

  private assertValidTraining(training?: TrainingConfig): asserts training is TrainingConfig {
    if (!training) throw new Error('training configuration is required');

    if (typeof training.optimizerName !== 'string' || !training.optimizerName)
      throw new Error('optimizerName must be a known optimizer');

    if (!(training.learningRate > 0)) throw new Error('learningRate must be > 0');
    if (!(training.epochs > 0)) throw new Error('epochs must be > 0');
    if (!(training.interval > 0)) throw new Error('interval must be > 0');

    if (!(training.verbose === 0 || training.verbose === 1)) throw new Error('verbose must be 0 or 1');

    if (typeof training.loss !== 'string') throw new Error('loss must be a string');
  }
}
