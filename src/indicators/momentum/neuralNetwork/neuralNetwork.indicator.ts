import { SMMA } from '@indicators/movingAverages/smma/smma.indicator';
import { Candle } from '@models/candle.types';
import { Nullable } from '@models/utility.types';
import { Net } from '@services/learning/network/net';
import { Trainer } from '@services/learning/training/trainer';
import { Vol } from '@services/learning/volume/vol';
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

export class NeuralNetwork extends Indicator<'neuralNetwork'> {
  // ---- State
  private smma: SMMA;
  private buffer: RingBuffer<number>;
  private net: Net;
  private trainer: Trainer;
  private lastSmoothRes: Nullable<number>;
  private trainCache: RingBuffer<number>;
  private tick: number;
  private inputDepth: number;
  private isRehearse: boolean;

  constructor({
    layers = [],
    training,
    smoothPeriod = 5,
    isRehearse = false,
  }: IndicatorRegistry['neuralNetwork']['input'] = {}) {
    super('neuralNetwork', null);

    const input = layers[0];
    if (!input?.out_depth) throw new Error('Input layer out_depth must be defined');
    this.inputDepth = input.out_depth;

    this.smma = new SMMA({ period: smoothPeriod });
    this.buffer = new RingBuffer(this.inputDepth + 1);
    this.trainCache = new RingBuffer(Math.max(this.inputDepth * 3, REHEARSE_WINDOW_SIZE + this.inputDepth));
    this.lastSmoothRes = null;
    this.isRehearse = isRehearse;
    this.tick = 0;

    // Build the network
    const trainingDefaults = { learningRate: 0.001, momentum: 0, batchSize: 1, l2Decay: 0.0001 };
    const trainingCfg = { ...trainingDefaults, ...(training ?? {}) };
    this.net = new Net();
    this.net.makeLayers(layers);
    this.trainer = new Trainer(this.net, trainingCfg);
  }

  public onNewCandle(candle: Candle) {
    // Smoothing data
    this.smma.onNewCandle({ close: ohlc4(candle) } as Candle);
    const smmaRes = this.smma.getResult();

    // Training Neural Network
    if (Number.isFinite(smmaRes) && Number.isFinite(this.lastSmoothRes)) {
      const rawRt = Math.log(smmaRes! / (this.lastSmoothRes! + EPSILON));
      const r_t = Number.isFinite(rawRt) ? this.clip(rawRt, -CLIP, CLIP) : 0;
      this.buffer.push(r_t);
      this.trainCache.push(r_t);
      this.learn();
      this.result = this.predictCandle(smmaRes!) ?? null;
    }
    // Updating state
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

    const buf = this.buffer.toArray(); // length = N+1
    const x = buf.slice(0, -1); // N inputs: r_{t-N+1..t}
    const y = [buf[buf.length - 1]]; // label: r_{t+1}
    const vol = new Vol(x);

    for (let i = 0; i < TRAINING_EPOCHS; i++) this.trainer.train(vol, y);
  }

  private predictCandle(currentSmma: number) {
    if (!this.buffer.isFull() || !Number.isFinite(currentSmma)) return;

    const x = this.buffer.toArray().slice(1); // last N returns
    const vol = new Vol(x);
    const pred = this.net.forward(vol);
    const r_next = pred.w[0];

    if (!Number.isFinite(r_next)) return;
    return currentSmma * Math.exp(r_next);
  }

  private clip(x: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, x));
  }

  private rehearse(span: number, epochs: number) {
    const all = this.trainCache.toArray();
    if (all.length < this.inputDepth + 1) return;

    // take the last `span + inputDepth` returns to build sliding pairs
    const start = Math.max(0, all.length - (span + this.inputDepth));
    const window = all.slice(start); // length >= inputDepth+1

    // slide and train
    for (let i = this.inputDepth; i < window.length; i++) {
      const x = window.slice(i - this.inputDepth, i); // N inputs
      const y = [window[i]]; // 1 label
      const vol = new Vol(x);
      for (let e = 0; e < epochs; e++) this.trainer.train(vol, y);
    }
  }
}
