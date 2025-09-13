import { layers, train } from '@tensorflow/tfjs-node';

declare global {
  interface IndicatorRegistry {
    neuralNetwork: {
      input: {
        inputDepth?: number;
        layers?: LayerConfig[];
        training?: TrainingConfig;
        smoothPeriod?: number;
        isRehearse?: boolean;
      };
      output: number | null;
    };
  }
}

type Train = typeof train;
type Layers = typeof layers;
type LayersKeys = keyof Layers;
export type TrainingConfig = {
  optimizerName: keyof Train;
  learningRate: number;
  epochs: number;
  loss: string;
  verbose: number;
};
export type LayerConfig = Layers & { name: LayersKeys };
