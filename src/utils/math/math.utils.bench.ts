import { bench, describe } from 'vitest';
import { addPrecise, linreg, percentile, stdev, weightedMean } from './math.utils';

// Sample data for benchmarks
const smallArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const mediumArray = Array.from({ length: 100 }, (_, i) => i + Math.random());
const largeArray = Array.from({ length: 1000 }, (_, i) => i + Math.random());

describe('stdev Performance', () => {
  bench('stdev - small array (10 elements)', () => {
    stdev(smallArray);
  });

  bench('stdev - medium array (100 elements)', () => {
    stdev(mediumArray);
  });

  bench('stdev - large array (1000 elements)', () => {
    stdev(largeArray);
  });
});

describe('percentile Performance', () => {
  bench('percentile - small array (10 elements)', () => {
    percentile(smallArray, 0.25);
  });

  bench('percentile - medium array (100 elements)', () => {
    percentile(mediumArray, 0.25);
  });

  bench('percentile - large array (1000 elements)', () => {
    percentile(largeArray, 0.25);
  });

  bench('percentile - multiple percentiles', () => {
    percentile(mediumArray, 0.1);
    percentile(mediumArray, 0.25);
    percentile(mediumArray, 0.5);
    percentile(mediumArray, 0.75);
    percentile(mediumArray, 0.9);
  });
});

describe('weightedMean Performance', () => {
  const weightsSmall = smallArray.map(() => Math.random());
  const weightsMedium = mediumArray.map(() => Math.random());
  const weightsLarge = largeArray.map(() => Math.random());

  bench('weightedMean - small array (10 elements)', () => {
    weightedMean(smallArray, weightsSmall);
  });

  bench('weightedMean - medium array (100 elements)', () => {
    weightedMean(mediumArray, weightsMedium);
  });

  bench('weightedMean - large array (1000 elements)', () => {
    weightedMean(largeArray, weightsLarge);
  });
});

describe('linreg Performance', () => {
  const xSmall = smallArray;
  const ySmall = smallArray.map(x => x * 2 + Math.random());
  const xMedium = mediumArray;
  const yMedium = mediumArray.map(x => x * 2 + Math.random());
  const xLarge = largeArray;
  const yLarge = largeArray.map(x => x * 2 + Math.random());

  bench('linreg - small array (10 elements)', () => {
    linreg(xSmall, ySmall);
  });

  bench('linreg - medium array (100 elements)', () => {
    linreg(xMedium, yMedium);
  });

  bench('linreg - large array (1000 elements)', () => {
    linreg(xLarge, yLarge);
  });
});

describe('addPrecise Performance', () => {
  bench('addPrecise - simple addition', () => {
    addPrecise(0.1, 0.2);
  });

  bench('addPrecise - many decimals', () => {
    addPrecise(1.23456789, 9.87654321);
  });

  bench('addPrecise - scientific notation', () => {
    addPrecise(1e-7, 2e-7);
  });

  bench('addPrecise - 100 sequential additions', () => {
    let result = 0;
    for (let i = 0; i < 100; i++) {
      result = addPrecise(result, 0.01);
    }
  });
});
