import * as tf from '@tensorflow/tfjs-node';
tf.setBackend('tensorflow');

import { SMMA } from '@indicators/movingAverages/smma/smma.indicator';
import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { ohlc4 } from '@utils/candle/candle.utils';

import { Indicator } from '../../indicator';

import { LayerConfig, TrainingConfig } from './neuralNetwork.types';
import {
  CLIP,
  EPSILON,
  REHEARSE_INTERVAL,
  REHEARSE_TRAINING_EPOCHS,
  REHEARSE_WINDOW_SIZE,
} from './neuronalNetwork.const';

export class NeuralNetwork extends Indicator<'neuralNetwork'> {
  private smma: SMMA;
  private buffer: RingBuffer<number>;
  private trainBuffer: RingBuffer<number>;
  private lastSmoothRes: Nullable<number>;
  private tick: number;
  private inputDepth: number;
  private isRehearse: boolean;

  private model: tf.Sequential;
  private optimizer: tf.Optimizer;
  private training: TrainingConfig;

  constructor({
    inputDepth = 1,
    layers = [],
    training,
    smoothPeriod = 5,
    isRehearse = false,
  }: IndicatorRegistry['neuralNetwork']['input'] = {}) {
    super('neuralNetwork', null);

    this.assertValidLayers(layers);
    this.assertValidTraining(training);

    this.inputDepth = inputDepth;
    this.smma = new SMMA({ period: smoothPeriod });
    this.buffer = new RingBuffer(this.inputDepth + 1);
    this.trainBuffer = new RingBuffer(Math.max(this.inputDepth * 3, REHEARSE_WINDOW_SIZE + this.inputDepth));
    this.lastSmoothRes = null;
    this.isRehearse = isRehearse;
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
      const rawRt = Math.log(smmaRes! / (this.lastSmoothRes! + EPSILON));
      const r_t = Number.isFinite(rawRt) ? this.clip(rawRt, -CLIP, CLIP) : 0;
      this.buffer.push(r_t);
      this.trainBuffer.push(r_t);
      await this.learn();
      this.result = this.predictCandle(smmaRes!) ?? null;
    }

    this.lastSmoothRes = smmaRes;

    if (this.isRehearse) {
      this.tick++;
      if (this.tick >= REHEARSE_INTERVAL) {
        await this.rehearse(REHEARSE_WINDOW_SIZE, REHEARSE_TRAINING_EPOCHS);
        this.tick = 0;
      }
    }
  }

  public getResult() {
    return this.result;
  }

  private async learn() {
    if (!this.buffer.isFull()) return;

    const buf = this.buffer.toArray();
    const x = buf.slice(0, -1);
    const y = buf[buf.length - 1];

    const xs = tf.tensor2d([x]);
    const ys = tf.tensor2d([[y]]);
    await this.model.fit(xs, ys, { epochs: this.training.epochs, verbose: this.training.verbose });
    xs.dispose();
    ys.dispose();
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

  private async rehearse(span: number, epochs: number) {
    const all = this.trainBuffer.toArray();
    if (all.length < this.inputDepth + 1) return;

    const start = Math.max(0, all.length - (span + this.inputDepth));
    const window = all.slice(start);

    for (let i = this.inputDepth; i < window.length; i++) {
      const x = window.slice(i - this.inputDepth, i);
      const y = window[i];
      const xs = tf.tensor2d([x]);
      const ys = tf.tensor2d([[y]]);
      await this.model.fit(xs, ys, { epochs, verbose: this.training.verbose });
      xs.dispose();
      ys.dispose();
    }
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
    if (!training?.optimizerName) throw new Error('optimizerName must be a string');
    if (!training.learningRate) throw new Error('learningRate must be positive');
    if (!training.epochs) throw new Error('epochs must be positive');
    if (!training.verbose) throw new Error('verbose must be 0 or 1');
    if (!training.loss) throw new Error('loss must be a string');
  }
}
