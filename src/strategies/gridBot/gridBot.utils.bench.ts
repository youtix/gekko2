import { Portfolio } from '@models/portfolio.types';
import { MarketData } from '@services/exchange/exchange.types';
import { bench, describe } from 'vitest';
import {
  applyAmountLimits,
  applyCostLimits,
  computeGridBounds,
  computeLevelPrice,
  computeRebalancePlan,
  countDecimals,
  deriveLevelQuantity,
  hasOnlyOneSide,
  inferAmountPrecision,
  inferPricePrecision,
  isOutOfRange,
  roundAmount,
  roundPrice,
  validateConfig,
} from './gridBot.utils';

const portfolio: Portfolio = {
  asset: { free: 10, used: 0, total: 10 },
  currency: { free: 1000, used: 0, total: 1000 },
};

const marketData: MarketData = {
  precision: { price: 0.01, amount: 0.001 },
  amount: { min: 0.001, max: 1000 },
  cost: { min: 1, max: 100000 },
};

describe('gridBot.utils Performance', () => {
  describe('countDecimals', () => {
    bench('1000 decimal counts', () => {
      for (let i = 0; i < 1000; i++) {
        countDecimals(100.12345);
      }
    });

    bench('1000 scientific notation counts', () => {
      for (let i = 0; i < 1000; i++) {
        countDecimals(1e-7);
      }
    });
  });

  describe('roundPrice', () => {
    bench('10000 price roundings without step', () => {
      for (let i = 0; i < 10000; i++) {
        roundPrice(100.12345, 2);
      }
    });

    bench('10000 price roundings with step', () => {
      for (let i = 0; i < 10000; i++) {
        roundPrice(100.12345, 2, 0.05);
      }
    });
  });

  describe('roundAmount', () => {
    bench('10000 amount roundings', () => {
      for (let i = 0; i < 10000; i++) {
        roundAmount(1.23456, 3);
      }
    });
  });

  describe('computeLevelPrice', () => {
    bench('1000 fixed spacing calculations', () => {
      for (let i = 0; i < 1000; i++) {
        computeLevelPrice(100, (i % 10) - 5, 2, 'fixed', 5);
      }
    });

    bench('1000 percent spacing calculations', () => {
      for (let i = 0; i < 1000; i++) {
        computeLevelPrice(100, (i % 10) - 5, 2, 'percent', 1);
      }
    });

    bench('1000 logarithmic spacing calculations', () => {
      for (let i = 0; i < 1000; i++) {
        computeLevelPrice(100, (i % 10) - 5, 2, 'logarithmic', 0.01);
      }
    });
  });

  describe('inferPricePrecision', () => {
    bench('10000 precision inferences', () => {
      for (let i = 0; i < 10000; i++) {
        inferPricePrecision(100.12345, marketData);
      }
    });
  });

  describe('inferAmountPrecision', () => {
    bench('10000 amount precision inferences', () => {
      for (let i = 0; i < 10000; i++) {
        inferAmountPrecision(marketData);
      }
    });
  });

  describe('computeGridBounds', () => {
    bench('1000 grid bounds calculations', () => {
      for (let i = 0; i < 1000; i++) {
        computeGridBounds(100, 5, 5, 2, 'fixed', 5);
      }
    });
  });

  describe('isOutOfRange', () => {
    const bounds = { min: 90, max: 110 };

    bench('10000 range checks', () => {
      for (let i = 0; i < 10000; i++) {
        isOutOfRange(100 + ((i % 50) - 25), bounds);
      }
    });
  });

  describe('validateConfig', () => {
    const params = { buyLevels: 5, sellLevels: 5, spacingType: 'fixed' as const, spacingValue: 5 };

    bench('1000 config validations', () => {
      for (let i = 0; i < 1000; i++) {
        validateConfig(params, 100, marketData);
      }
    });
  });

  describe('applyAmountLimits', () => {
    bench('10000 amount limit applications', () => {
      for (let i = 0; i < 10000; i++) {
        applyAmountLimits(i % 100, marketData);
      }
    });
  });

  describe('applyCostLimits', () => {
    bench('10000 cost limit applications', () => {
      for (let i = 0; i < 10000; i++) {
        applyCostLimits(1, 90 + (i % 20), 110 + (i % 20), marketData);
      }
    });
  });

  describe('computeRebalancePlan', () => {
    bench('1000 rebalance plan calculations', () => {
      for (let i = 0; i < 1000; i++) {
        computeRebalancePlan(100, portfolio, 5, 5, marketData);
      }
    });
  });

  describe('deriveLevelQuantity', () => {
    bench('100 quantity derivations', () => {
      for (let i = 0; i < 100; i++) {
        deriveLevelQuantity(100, portfolio, 5, 5, 2, 'fixed', 5, marketData);
      }
    });
  });

  describe('hasOnlyOneSide', () => {
    const levels = [
      { side: 'BUY' as const, orderId: '1' },
      { side: 'BUY' as const, orderId: '2' },
      { side: 'SELL' as const, orderId: '3' },
      { side: 'SELL' as const, orderId: '4' },
    ];

    bench('10000 side checks', () => {
      for (let i = 0; i < 10000; i++) {
        hasOnlyOneSide(levels);
      }
    });
  });
});
