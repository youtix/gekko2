import { GekkoError } from '@errors/gekko.error';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STRATEGY_ADVICE_EVENT, STRATEGY_WARMUP_COMPLETED_EVENT } from '../plugins/plugin.const';
import { StrategyManager } from './strategyManager';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@services/configuration/configuration', () => {
  const Configuration = vi.fn(() => ({
    getStrategy: vi.fn(() => ({ each: 1, wait: 0 })),
  }));
  return { config: new Configuration() };
});
vi.mock('@strategies/index', () => ({
  DummyStrategy: class {
    init = vi.fn();
    onEachCandle = vi.fn();
    onCandleAfterWarmup = vi.fn();
    onTradeCompleted = vi.fn();
    log = vi.fn();
    end = vi.fn();
  },
  UnknownStrategy: undefined,
}));
vi.mock('./debug/debugAdvice.startegy.ts', () => ({
  DebugAdvice: class {
    init = vi.fn();
    onEachCandle = vi.fn();
    onCandleAfterWarmup = vi.fn();
    onTradeCompleted = vi.fn();
    log = vi.fn();
    end = vi.fn();
  },
}));

describe('StrategyManager', () => {
  let manager: StrategyManager;
  const candle = {
    start: 0,
    open: 1,
    high: 2,
    low: 0,
    close: 1,
    volume: 1,
  } as any;
  const trade = { id: '1' } as any;

  beforeEach(() => {
    manager = new StrategyManager(1);
  });

  describe('createStrategy', () => {
    it('should instantiate strategy and mark as initialized', async () => {
      await manager.createStrategy('DummyStrategy');
      const strategy: any = (manager as any).strategy;
      expect(strategy).toBeDefined();
      expect((manager as any).isStartegyInitialized).toBe(true);
      expect(strategy.init).toHaveBeenCalled();
    });

    it('should load strategy from provided path', async () => {
      const strategyPath = path.resolve(__dirname, './debug/debugAdvice.startegy.ts');
      await manager.createStrategy('DebugAdvice', strategyPath);
      const strategy: any = (manager as any).strategy;
      expect(strategy).toBeDefined();
      expect(strategy.init).toHaveBeenCalled();
    });

    it('should throw when strategy does not exist', async () => {
      await expect(manager.createStrategy('UnknownStrategy')).rejects.toThrow(GekkoError);
    });
  });

  describe('addIndicator', () => {
    it('should add indicator before initialization', () => {
      const indicator = (manager as any).addIndicator('SMA', { period: 1 });
      expect(indicator).toBeDefined();
      expect((manager as any).indicators).toHaveLength(1);
    });

    it('should throw when called after initialization', async () => {
      await manager.createStrategy('DummyStrategy');
      expect(() => (manager as any).addIndicator('SMA', { period: 1 })).toThrow(GekkoError);
    });
  });

  describe('advice', () => {
    it('should emit strategy advice event with incremented id', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_ADVICE_EVENT, listener);
      const id = (manager as any).advice('long');
      expect(id).toBe(1);
      expect(listener).toHaveBeenCalledWith({
        id: 'advice-1',
        recommendation: 'long',
      });
    });

    it('should ignore repeated direction', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_ADVICE_EVENT, listener);
      (manager as any).advice('long');
      const id = (manager as any).advice('long');
      expect(id).toBeUndefined();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('warmup', () => {
    it('should emit warmup completed after exceeding period', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_WARMUP_COMPLETED_EVENT, listener);
      (manager as any).warmup(candle);
      expect(listener).not.toHaveBeenCalled();
      (manager as any).warmup(candle);
      expect(listener).toHaveBeenCalledWith(candle);
      expect((manager as any).isWarmupCompleted).toBe(true);
    });
  });

  describe('onNewCandle', () => {
    it('should call indicator and strategy functions', () => {
      const indicator = { onNewCandle: vi.fn(), getResult: vi.fn(() => 42) };
      (manager as any).indicators.push(indicator);
      const strategy: any = {
        onEachCandle: vi.fn(),
        onCandleAfterWarmup: vi.fn(),
        log: vi.fn(),
      };
      (manager as any).strategy = strategy;
      manager.onNewCandle(candle);
      expect(indicator.onNewCandle).toHaveBeenCalledWith(candle);
      expect(indicator.getResult).toHaveBeenCalled();
      expect(strategy.onEachCandle).toHaveBeenCalled();
      expect(strategy.log).not.toHaveBeenCalled();
      expect(strategy.onCandleAfterWarmup).not.toHaveBeenCalled();
      manager.onNewCandle(candle);
      expect(strategy.log).toHaveBeenCalled();
      expect(strategy.onCandleAfterWarmup).toHaveBeenCalled();
    });
  });

  describe('onTradeCompleted', () => {
    it('should forward trade events to strategy', () => {
      const strategy: any = { onTradeCompleted: vi.fn() };
      (manager as any).strategy = strategy;
      manager.onTradeCompleted(trade);
      expect(strategy.onTradeCompleted).toHaveBeenCalledWith(trade);
    });
  });

  describe('finish', () => {
    it('should end strategy when finishing', () => {
      const strategy: any = { end: vi.fn() };
      (manager as any).strategy = strategy;
      manager.finish();
      expect(strategy.end).toHaveBeenCalled();
    });
  });
});
