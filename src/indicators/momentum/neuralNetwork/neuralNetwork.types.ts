import { layers, train } from '@tensorflow/tfjs-node';

declare global {
  interface IndicatorRegistry {
    neuralNetwork: {
      input: {
        layers: [FirstLayer, ...LayerConfig[]];
        training: TrainingConfig;
        smoothPeriod: number;
      };
      output: number | null;
    };
  }
}

type Train = typeof train;
type Layers = typeof layers;
type LayersKeys = keyof Layers;
export type TrainingConfig = {
  interval: number;
  optimizerName: keyof Train;
  learningRate: number;
  epochs: number;
  batchSize: number;
  loss: string;
  verbose: number;
};
type FirstLayer = Layers & { name: LayersKeys; inputShape: number };
export type LayerConfig = Layers & { name: LayersKeys };
