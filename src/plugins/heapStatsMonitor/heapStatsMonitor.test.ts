import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heapStats } from 'bun:jsc';
import { HeapStatsMonitor } from './heapStatsMonitor';
import { heapStatsMonitorSchema } from './heapStatsMonitor.schema';

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

describe('HeapStatsMonitor', () => {
  let monitor: HeapStatsMonitor;
  beforeEach(() => {
    monitor = new HeapStatsMonitor({ name: 'HeapStatsMonitor', interval: 2 });
    vi.spyOn(console, 'table').mockImplementation(() => undefined);
  });

  afterEach(() => {
    (console.table as unknown as vi.Mock).mockRestore();
  });

  it('should not log before interval is reached', () => {
    monitor.onStrategyAdvice();
    expect(console.table).not.toHaveBeenCalled();
  });

  it('should log heap stats when interval is reached', () => {
    monitor.onStrategyAdvice();
    monitor.onStrategyAdvice();
    expect(console.table).toHaveBeenCalledWith({
      heapSize: 1,
      heapCapacity: 2,
      extraMemorySize: 3,
      objectCount: 4,
      protectedObjectCount: 5,
    });
  });

  describe('getStaticConfiguration', () => {
    const config = HeapStatsMonitor.getStaticConfiguration();
    it('should return the correct schema', () => {
      expect(config.schema).toBe(heapStatsMonitorSchema);
    });
    it('should return modes equal to ["realtime", "backtest"]', () => {
      expect(config.modes).toEqual(['realtime', 'backtest']);
    });
    it('should return dependencies as an empty array', () => {
      expect(config.dependencies).toEqual([]);
    });
    it('should return inject as an empty array', () => {
      expect(config.inject).toEqual([]);
    });
    it('should return eventsHandlers containing all methods starting with "on"', () => {
      const expectedHandlers = Object.getOwnPropertyNames(HeapStatsMonitor.prototype).filter(p => p.startsWith('on'));
      expect(config.eventsHandlers).toEqual(expectedHandlers);
    });
    it('should return eventsEmitted as an empty array', () => {
      expect(config.eventsEmitted).toEqual([]);
    });
    it('should return name equal to HeapStatsMonitor.name', () => {
      expect(config.name).toBe(HeapStatsMonitor.name);
    });
  });
});
