declare global {
  interface IndicatorRegistry {
    neuralNetwork: {
      input: {
        hiddenLayers?: number[];
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
