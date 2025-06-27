import * as fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { heapStats } from 'bun:jsc';
import { HeapStatsMonitor } from './heapStatsMonitor';
import { heapStatsMonitorSchema } from './heapStatsMonitor.schema';

vi.mock('fs', () => ({
  mkdirSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
  appendFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('bun:jsc', () => ({
  heapStats: vi.fn(() => ({
    heapSize: 1,
    heapCapacity: 2,
    extraMemorySize: 3,
    objectCount: 4,
    protectedObjectCount: 5,
  })),
}));

vi.mock('../../services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getWatch: vi.fn(() => ({})),
    getStrategy: vi.fn(() => ({})),
  }));
  return { config: new Configuration() };
});

const HEADER = 'heapSize;heapCapacity;extraMemorySize;objectCount;protectedObjectCount\n';
const baseConfig = { name: 'HeapStatsMonitor', interval: 2, filePath: '/tmp', fileName: 'stats.csv' };

describe('HeapStatsMonitor', () => {
  const releaseMock = vi.fn();
  const lockSyncMock = vi.fn(() => releaseMock);
  let monitor: HeapStatsMonitor;

  beforeEach(() => {
    monitor = new HeapStatsMonitor(baseConfig);
    monitor['setFs']({ lockSync: lockSyncMock });
  });

  describe('#processInit', () => {
    it('creates missing directories and writes header when file is absent', () => {
      (fs.existsSync as Mock).mockReturnValue(false);
      (fs.statSync as Mock).mockReturnValue({ size: 0 });

      monitor['processInit']();

      const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.dirname(expectedPath), { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(expectedPath, HEADER, 'utf8');
      expect(lockSyncMock).toHaveBeenCalled();
    });
  });

  describe('#onStrategyAdvice', () => {
    it('appends stats to csv when interval is reached', () => {
      (fs.existsSync as Mock).mockReturnValue(true);
      (fs.statSync as Mock).mockReturnValue({ size: 10 });
      monitor['processInit']();

      monitor.onStrategyAdvice();
      expect(fs.appendFileSync).not.toHaveBeenCalled();

      monitor.onStrategyAdvice();
      const expectedPath = path.join(baseConfig.filePath, baseConfig.fileName);
      const expectedLine = '1;2;3;4;5\n';
      expect(fs.appendFileSync).toHaveBeenCalledWith(expectedPath, expectedLine, 'utf8');
      expect(releaseMock).toHaveBeenCalled();
    });
  });

  describe('getStaticConfiguration', () => {
    const config = HeapStatsMonitor.getStaticConfiguration();
    it('returns the correct schema', () => {
      expect(config.schema).toBe(heapStatsMonitorSchema);
    });
    it('returns modes equal to ["realtime", "backtest"]', () => {
      expect(config.modes).toEqual(['realtime', 'backtest']);
    });
    it('returns dependencies as an empty array', () => {
      expect(config.dependencies).toEqual([]);
    });
    it('returns inject equal to ["fs"]', () => {
      expect(config.inject).toEqual(['fs']);
    });
    it('returns eventsHandlers containing all methods starting with "on"', () => {
      const expected = Object.getOwnPropertyNames(HeapStatsMonitor.prototype).filter(p => p.startsWith('on'));
      expect(config.eventsHandlers).toEqual(expected);
    });
    it('returns eventsEmitted as an empty array', () => {
      expect(config.eventsEmitted).toEqual([]);
    });
    it('returns name equal to HeapStatsMonitor.name', () => {
      expect(config.name).toBe(HeapStatsMonitor.name);
    });
  });
});
