import type * as tf from '@tensorflow/tfjs-node';

declare global {
  interface IndicatorRegistry {
    neuralNetwork: {
      input: {
        layers?: Array<{ name: keyof typeof tf.layers; [key: string]: unknown }>;
        training?: {
          learningRate?: number;
          batchSize?: number;
          epochs?: number;
        };
        smoothPeriod?: number;
        isRehearse?: boolean;
      };
      output: number | null;
    };
  }
}

export {};
