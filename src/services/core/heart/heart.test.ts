import { GekkoError } from '@errors/gekko.error';
import { debug } from '@services/logger';
import { defer } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Heart } from './heart';

vi.mock('@services/logger', () => ({ debug: vi.fn() }));
vi.mock('lodash-es', async () => ({
  ...(await vi.importActual('lodash-es')),
  defer: vi.fn(),
  bindAll: vi.fn(),
}));

describe('Heart', () => {
  let heart: Heart;
  const tickRate = 20;
  const noop = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    heart = new Heart(tickRate);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with correct tickRate', () => {
      expect(heart['tickRate']).toBe(tickRate);
    });

    it('should initialize lastTick to 0', () => {
      expect(heart['lastTick']).toBe(0);
    });
  });

  describe('pump', () => {
    it('should log starting message', () => {
      heart.pump();
      expect(debug).toHaveBeenCalledWith('core', 'Starting heartbeat ticks');
    });

    it('should set an interval with the correct tickRate', () => {
      const setIntervalSpy = vi.spyOn(global, 'setInterval');
      heart.pump();
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), tickRate);
    });

    it('should defer the first tick', () => {
      heart.pump();
      expect(defer).toHaveBeenCalledWith(expect.any(Function));
    });
  });

  describe('tick', () => {
    it.each`
      description              | existingLastTick | setupTime | expectedError | setupFn
      ${'first tick (0)'}      | ${0}             | ${100}    | ${false}      | ${noop}
      ${'timely tick'}         | ${100}           | ${120}    | ${false}      | ${noop}
      ${'excessively delayed'} | ${100}           | ${500}    | ${true}       | ${noop}
    `('should handle $description', ({ existingLastTick, setupTime, expectedError, setupFn }) => {
      heart['lastTick'] = existingLastTick;
      vi.setSystemTime(setupTime);
      setupFn();

      const emitSpy = vi.spyOn(heart, 'emit');

      if (expectedError) {
        expect(() => heart.tick()).toThrowError(GekkoError);
      } else {
        heart.tick();
        expect(heart['lastTick']).toBe(setupTime);
        expect(emitSpy).toHaveBeenCalledWith('tick');
      }
    });

    it('should throw specific error message when too late', () => {
      heart['lastTick'] = 100;
      // tickRate is 20. 20 * 3 = 60. 100 + 60 = 160. So > 160 should fail.
      vi.setSystemTime(100 + tickRate * 3 + 1);
      expect(() => heart.tick()).toThrowError('Failed to tick in time');
    });
  });

  describe('stop', () => {
    it('should log stopping message', () => {
      heart.stop();
      expect(debug).toHaveBeenCalledWith('core', 'Stopping heartbeat ticks');
    });

    it('should clear the interval', () => {
      const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
      // Set a fake timeout to clear
      const timer = setInterval(noop, 10);
      heart['timeout'] = timer;

      heart.stop();
      expect(clearIntervalSpy).toHaveBeenCalledWith(timer);
    });

    it('should unset the timeout property', () => {
      heart['timeout'] = setInterval(noop, 10);
      heart.stop();
      expect(heart['timeout']).toBeUndefined();
    });
  });

  describe('isHeartBeating', () => {
    const heartPumpAndStop = () => {
      heart.pump();
      heart.stop();
    };
    it.each`
      scenario         | setup                 | expected
      ${'not started'} | ${noop}               | ${false}
      ${'started'}     | ${() => heart.pump()} | ${true}
      ${'stopped'}     | ${heartPumpAndStop}   | ${false}
    `('should return $expected when $scenario', ({ setup, expected }) => {
      setup();
      expect(heart.isHeartBeating()).toBe(expected);
    });
  });
});
