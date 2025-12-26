import { bench, describe } from 'vitest';
import {
  addPrecise,
  linreg,
  maxDrawdown,
  percentile,
  sharpeRatio,
  sortinoRatio,
  stdev,
  weightedMean,
} from './math.utils';

// Sample data for benchmarks
const smallArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const mediumArray = Array.from({ length: 100 }, (_, i) => i + Math.random());
const largeArray = Array.from({ length: 1000 }, (_, i) => i + Math.random());

// Returns data for ratio benchmarks
const tradeReturns = Array.from({ length: 100 }, () => (Math.random() - 0.4) * 10); // Mix of gains and losses

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

describe('sharpeRatio Performance', () => {
  const smallReturns = tradeReturns.slice(0, 10);
  const mediumReturns = tradeReturns;
  const largeReturns = Array.from({ length: 1000 }, () => (Math.random() - 0.4) * 10);

  bench('sharpeRatio - small returns (10 trades)', () => {
    sharpeRatio({
      returns: smallReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });

  bench('sharpeRatio - medium returns (100 trades)', () => {
    sharpeRatio({
      returns: mediumReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });

  bench('sharpeRatio - large returns (1000 trades)', () => {
    sharpeRatio({
      returns: largeReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });
});

describe('sortinoRatio Performance', () => {
  const smallReturns = tradeReturns.slice(0, 10);
  const mediumReturns = tradeReturns;
  const largeReturns = Array.from({ length: 1000 }, () => (Math.random() - 0.4) * 10);

  bench('sortinoRatio - small returns (10 trades)', () => {
    sortinoRatio({
      returns: smallReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });

  bench('sortinoRatio - medium returns (100 trades)', () => {
    sortinoRatio({
      returns: mediumReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });

  bench('sortinoRatio - large returns (1000 trades)', () => {
    sortinoRatio({
      returns: largeReturns,
      yearlyProfit: 15,
      riskFreeReturn: 2,
      elapsedYears: 1,
    });
  });
});

describe('maxDrawdown Performance', () => {
  const smallBalances = Array.from({ length: 10 }, (_, i) => 1000 + (i % 3 === 0 ? -50 : 30) * i);
  const mediumBalances = Array.from({ length: 100 }, (_, i) => 1000 + (i % 3 === 0 ? -50 : 30) * Math.sin(i));
  const largeBalances = Array.from({ length: 1000 }, (_, i) => 1000 + (i % 3 === 0 ? -50 : 30) * Math.sin(i));

  bench('maxDrawdown - small balances (10 samples)', () => {
    maxDrawdown(smallBalances, 1000);
  });

  bench('maxDrawdown - medium balances (100 samples)', () => {
    maxDrawdown(mediumBalances, 1000);
  });

  bench('maxDrawdown - large balances (1000 samples)', () => {
    maxDrawdown(largeBalances, 1000);
  });
});
