import { beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { TelegramBot } from './TelegramBot';

vi.mock('@services/fetcher/fetcher.service', () => ({
  fetcher: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const { fetcher } = await import('@services/fetcher/fetcher.service');

describe('TelegramBot', () => {
  let bot: TelegramBot;
  const token = 'test-token';

  beforeEach(() => {
    bot = new TelegramBot(token);
    vi.clearAllMocks();
  });

  it('fetchUpdates should return updates and update offset', async () => {
    const updates = [
      { update_id: 1, message: { text: 'a', chat: { id: 1 } } },
      { update_id: 2, message: { text: 'b', chat: { id: 2 } } },
    ];
    (fetcher.get as Mock).mockResolvedValue({ ok: true, result: updates });
    const result = await (bot as any).fetchUpdates();
    expect(fetcher.get).toHaveBeenCalledWith({
      url: `https://api.telegram.org/bot${token}/getUpdates?timeout=50&offset=1`,
    });
    expect(result).toEqual(updates);
    expect((bot as any).offset).toBe(2);
  });

  it('fetchUpdates should return empty array when response not ok', async () => {
    (fetcher.get as Mock).mockResolvedValue({ ok: false, result: [] });
    const result = await (bot as any).fetchUpdates();
    expect(result).toEqual([]);
  });

  it('sendMessage should call fetcher.post with correct args', async () => {
    (fetcher.post as Mock).mockResolvedValue({});
    await bot.sendMessage('hello', 10);
    expect(fetcher.post).toHaveBeenCalledWith({
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      payload: { chat_id: 10, text: 'hello' },
    });
  });

  describe('checkUpdates', () => {
    it('should process commands via handleCommand', async () => {
      const handle = vi.fn().mockReturnValue('pong');
      bot = new TelegramBot(token, handle);
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [{ update_id: 1, message: { text: '/ping', chat: { id: 4 } } }],
      });
      bot.sendMessage = vi.fn();
      await (bot as any).checkUpdates();
      expect(handle).toHaveBeenCalledWith('/ping');
      expect(bot.sendMessage).toHaveBeenCalledWith('pong');
    });

    it('should ignore updates without message text', async () => {
      (fetcher.get as Mock).mockResolvedValue({ ok: true, result: [{ update_id: 1 }] });
      bot.sendMessage = vi.fn();
      await (bot as any).checkUpdates();
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });

    it('should continue processing updates after one without text', async () => {
      const handle = vi.fn().mockReturnValue('pong');
      bot = new TelegramBot(token, handle);
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [{ update_id: 1 }, { update_id: 2, message: { text: '/ping', chat: { id: 7 } } }],
      });
      bot.sendMessage = vi.fn();
      await (bot as any).checkUpdates();
      expect(handle).toHaveBeenCalledWith('/ping');
      expect(bot.sendMessage).toHaveBeenCalledWith('pong');
    });
    it('should ignore updates without command', async () => {
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [{ update_id: 1, message: { text: 'hi', chat: { id: 3 } } }],
      });
      bot.sendMessage = vi.fn();
      await (bot as any).checkUpdates();
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });
  });
});
