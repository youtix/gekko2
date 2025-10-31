import { Report } from '@plugins/performanceAnalyser/performanceAnalyzer.types';
import { formatDuration, intervalToDuration } from 'date-fns';
import * as fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { PerformanceReporter } from './performanceReporter';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('@services/logger', () => ({
  error: vi.fn(),
}));

vi.mock('@services/configuration/configuration', () => ({
  config: {
    getWatch: vi.fn(() => ({ asset: 'BTC', currency: 'USDT', warmup: {} })),
    getStrategy: vi.fn(() => ({ name: 'DEMA' })),
  },
}));

const HEADER =
  'id;pair;start time;end time;duration;exposure;start price;end price;market;alpha;yearly profit;total orders;original balance;current balance;sharpe ratio;sortino ratio;standard deviation;expected downside\n';

const baseConfig = {
  name: 'PerformanceReporter',
  filePath: '/tmp',
  fileName: 'performance_report.csv',
};

const sampleReport: Report = {
  startTime: 1748563200000,
  endTime: 1748649600000,
  duration: formatDuration(intervalToDuration({ start: 1748563200000, end: 1748649600000 })),
  exposure: 0.5,
  startPrice: 100,
  endPrice: 110,
  market: 0.01,
  alpha: 0.12,
  yearlyProfit: 3650,
  relativeYearlyProfit: 116.8,
  orders: 4,
  startBalance: 1000,
  balance: 1320,
  sharpe: 1.25,
  sortino: 1.1,
  standardDeviation: 2.5,
  downside: 0.08,
  profit: 10,
  relativeProfit: 1,
};

// ---------------------------------------------------------------------------

describe('PerformanceReporter', () => {
  const releaseMock = vi.fn();
  const lockSyncMock = vi.fn(() => releaseMock);
  let reporter: PerformanceReporter;

  beforeEach(() => {
    reporter = new PerformanceReporter(baseConfig);
    reporter['setFs']({ lockSync: lockSyncMock });
  });

  describe('#processInit', () => {
    it('should creates missing directories and writes the CSV header when the file is absent', async () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.statSync as Mock).mockReturnValue({ size: 0 });
      await reporter['processInit']();
      const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);

      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(expectedPath), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedPath, HEADER, 'utf8');
      expect(lockSyncMock).toHaveBeenCalled();
      expect(reporter).toBeInstanceOf(PerformanceReporter);
    });

    it('should not rewrite the header when the file already exists with content', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 123 });

      await reporter['processInit']();

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('#onPerformanceReport', () => {
    it('should append the formatted report line to the CSV file', async () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 123 });
      await reporter['processInit']();

      reporter.onPerformanceReport(sampleReport);

      const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);
      const expectedLine =
        [
          'DEMA',
          'BTC/USDT',
          '2025-05-30T00:00:00.000Z',
          '2025-05-31T00:00:00.000Z',
          '1 day',
          '0.5%',
          '100 USDT',
          '110 USDT',
          '0.01%',
          '0.12%',
          '3,650 USDT (116.8%)',
          '4',
          '1,000 USDT',
          '1,320 USDT',
          '1.25',
          '1.10',
          '2.50',
          '0.08%',
        ].join(';') + '\n';

      expect(fs.appendFileSync).toHaveBeenCalledWith(expectedPath, expectedLine, 'utf8');
      expect(releaseMock).toHaveBeenCalled();
    });
  });

  describe('#getStaticConfiguration', () => {
    it('should return the expected static metadata', () => {
      const meta = PerformanceReporter.getStaticConfiguration();

      expect(meta).toMatchObject({
        name: 'PerformanceReporter',
        modes: expect.arrayContaining(['backtest']),
      });
      expect(meta.schema).toBeDefined();
    });
  });
});
