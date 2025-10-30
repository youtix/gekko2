import {
  STRATEGY_CREATE_ORDER_EVENT,
  STRATEGY_INFO_EVENT,
  STRATEGY_WARMUP_COMPLETED_EVENT,
} from '@constants/event.const';
import { GekkoError } from '@errors/gekko.error';
import { debug, error, info, warning } from '@services/logger';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StrategyManager } from './strategyManager';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'db2254e3-c749-448c-b7b6-aa28831bbae7'),
}));

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
    onOrderCompleted = vi.fn();
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
    onOrderCompleted = vi.fn();
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

  describe('create order', () => {
    it('should emit strategy advice event with incremented id', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
      const order = { side: 'BUY', type: 'STICKY', quantity: 1 } as const;
      const id = manager['createOrder'](order);
      expect(id).toBe('db2254e3-c749-448c-b7b6-aa28831bbae7');
      expect(listener).toHaveBeenCalledWith({
        id: 'db2254e3-c749-448c-b7b6-aa28831bbae7',
        order,
      });
    });

    it('should emit when quantity changes', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_CREATE_ORDER_EVENT, listener);
      manager['createOrder']({ side: 'BUY', type: 'STICKY', quantity: 1 });
      manager['createOrder']({ side: 'BUY', type: 'STICKY', quantity: 2 });
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('log', () => {
    it.each`
      logFn      | level
      ${debug}   | ${'debug'}
      ${info}    | ${'info'}
      ${warning} | ${'warn'}
      ${error}   | ${'error'}
    `('should call $level log function', ({ logFn, level }) => {
      manager['log'](level, 'Hello World !');
      expect(logFn).toHaveBeenCalledTimes(1);
    });

    it('should emit strategy info event', () => {
      const listener = vi.fn();
      manager.on(STRATEGY_INFO_EVENT, listener);
      (manager as any).log('error', 'Hello World !');
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

  describe('onOrderCompleted', () => {
    it('should forward trade events to strategy', () => {
      const strategy: any = { onOrderCompleted: vi.fn() };
      (manager as any).strategy = strategy;
      manager.onOrderCompleted(trade);
      expect(strategy.onOrderCompleted).toHaveBeenCalledWith(trade);
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
