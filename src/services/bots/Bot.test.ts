import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bot } from './Bot';

class TestBot extends Bot {
  public checkUpdates = vi.fn().mockResolvedValue(undefined);
}

describe('Bot', () => {
  let bot: TestBot;

  beforeEach(() => {
    vi.useFakeTimers();
    bot = new TestBot();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should call setInterval with checkUpdates when listen is called', () => {
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    bot.listen(200);
    expect(setIntervalSpy).toHaveBeenCalledWith(bot.checkUpdates, 200);
  });

  it('should stop interval when close is called', async () => {
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');
    bot.listen(100);
    await vi.advanceTimersByTimeAsync(100);
    expect(bot.checkUpdates).toHaveBeenCalledTimes(1);

    bot.close();
    expect(clearIntervalSpy).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(bot.checkUpdates).toHaveBeenCalledTimes(1);
  });
});
