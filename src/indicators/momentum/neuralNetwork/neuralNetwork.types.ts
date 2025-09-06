import { LayerDef } from '@models/layer.types';

declare global {
  interface IndicatorRegistry {
    neuralNetwork: {
      input: {
        layers?: LayerDef[];
        training?: {
          learningRate: number;
          momentum: number;
          batchSize: number;
          l2Decay: number;
        };
        smoothPeriod?: number;
        isRehearse?: boolean;
      };
      output: number | null; // predicted next price (or null until ready)
    };
  }
}

export {};
