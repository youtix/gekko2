import { getUnixTime } from 'date-fns';
import { defer } from 'lodash-es';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FailedtoTickOnTimeError } from '../../../errors/failedToTickOnTime.error';
import { Heart } from './heart';

vi.mock('../../logger', () => ({ logger: { debug: vi.fn() } }));
vi.mock('./heart.utils', () => ({ getTickRate: vi.fn().mockReturnValue(20) }));
vi.mock('lodash-es', async () => ({
  ...(await vi.importActual('lodash-es')),
  defer: vi.fn().mockImplementation(fn => fn()),
}));

describe('Heart', () => {
  let heart: Heart;

  beforeEach(() => {
    heart = new Heart(5);
    vi.useFakeTimers();
    vi.spyOn(global, 'setInterval');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize without errors', () => {
    expect(() => new Heart(5)).not.toThrow();
  });

  it('should schedule ticks when pump is called', () => {
    heart.pump();
    expect(setInterval).toHaveBeenCalled();
  });

  it('should emit tick event on each tick', () => {
    const emitSpy = vi.spyOn(heart, 'emit');
    heart.tick();
    expect(emitSpy).toHaveBeenCalledWith('tick');
  });

  /** Make sure the last tick happened not to lang ago @link https://github.com/askmike/gekko/issues/514 */
  it('should throw if tick is excessively delayed', () => {
    vi.setSystemTime(10000);
    heart['lastTick'] = getUnixTime(new Date()) - 100;
    expect(() => heart.tick()).toThrowError(FailedtoTickOnTimeError);
  });

  it('should update lastTick on every tick', () => {
    const initialTime = getUnixTime(new Date());
    heart.tick();
    expect(heart['lastTick']).toBeGreaterThanOrEqual(initialTime);
  });

  it.each`
    tickRate
    ${1}
    ${5}
    ${10}
  `('should handle tick intervals correctly with tickRate = $tickRate', ({ tickRate }) => {
    vi.spyOn(global, 'setInterval');
    vi.spyOn(global, 'setTimeout');
    heart['tickRate'] = tickRate;
    heart.pump();
    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), tickRate * 1000);
  });

  it('should trigger an immediate tick with defer', () => {
    heart.pump();
    expect(defer).toHaveBeenCalledWith(heart.tick);
  });

  it('should not throw error if tick is called without previous ticks', () => {
    expect(() => heart.tick()).not.toThrow();
  });
});
