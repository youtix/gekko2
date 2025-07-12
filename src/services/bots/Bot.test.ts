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

  it('should set isListening to true when listen is called', () => {
    expect(bot['isListening']).toBeFalsy();
    bot.listen(200);
    expect(bot['isListening']).toBeTruthy();
  });
  it('should start calling checkUpdates in loop when listen is called', async () => {
    bot.listen(200);
    await vi.advanceTimersByTimeAsync(400);
    expect(bot.checkUpdates).toHaveBeenCalledTimes(3);
  });

  it('should set isListening to false when close is called', async () => {
    bot.listen(100);
    bot.close();
    await vi.advanceTimersByTimeAsync(300);
    expect(bot.checkUpdates).toHaveBeenCalledTimes(1);
    expect(bot['isListening']).toBeFalsy();
  });
});
