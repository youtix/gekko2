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
  const username = 'bot_name';

  beforeEach(() => {
    bot = new TelegramBot(token, username);
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

  it('fetchUpdates should keep the offset when there is no update', async () => {
    (fetcher.get as Mock).mockResolvedValue({ ok: true, result: [] });
    await (bot as any).fetchUpdates();
    expect((bot as any).offset).toBe(0);
  });

  it('sendMessage should call fetcher.post with correct args', async () => {
    (fetcher.post as Mock).mockResolvedValue({});
    await bot.sendMessage('hello', 10);
    expect(fetcher.post).toHaveBeenCalledWith({
      url: `https://api.telegram.org/bot${token}/sendMessage`,
      payload: { chat_id: 10, text: 'hello' },
    });
  });

  describe('sendMessage', () => {
    const LIMIT = 4096; // The Bot API's limit on the text of a message
    const sentPayloads = () => (fetcher.post as Mock).mock.calls.map(([{ payload }]) => payload as { chat_id?: number; text: string });
    const sentTexts = () => sentPayloads().map(({ text }) => text);
    const line = (char: string, length: number) => `${char.repeat(length - 1)}\n`; // `length` counts the line break

    it.each`
      description                         | text
      ${'a short text'}                   | ${'hello'}
      ${'a text at the limit'}            | ${'a'.repeat(LIMIT)}
      ${'a multi-line text at the limit'} | ${line('a', 10) + line('b', LIMIT - 10)}
    `('sends $description unchanged, in one message', async ({ text }) => {
      await bot.sendMessage(text, 10);
      expect(sentTexts()).toEqual([text]);
    });

    it.each`
      description                                            | text                                                   | parts
      ${'after the last line break in reach'}                | ${line('a', 3000) + line('b', 1000) + line('c', 2000)} | ${[line('a', 3000) + line('b', 1000), line('c', 2000)]}
      ${'after a line break on the last code unit in reach'} | ${line('a', 10) + line('b', LIMIT - 10) + 'c'}         | ${[line('a', 10) + line('b', LIMIT - 10), 'c']}
      ${'before a line break just out of reach'}             | ${line('a', 10) + line('b', LIMIT - 9) + 'c'}          | ${[line('a', 10), line('b', LIMIT - 9) + 'c']}
      ${'at the limit inside a line longer than a message'}  | ${'a'.repeat(LIMIT + 1)}                               | ${['a'.repeat(LIMIT), 'a']}
      ${'before a surrogate pair that straddles the limit'}  | ${'a'.repeat(LIMIT - 1) + '😀b'}                       | ${['a'.repeat(LIMIT - 1), '😀b']}
      ${'after a surrogate pair that ends on the limit'}     | ${'a'.repeat(LIMIT - 2) + '😀b'}                       | ${['a'.repeat(LIMIT - 2) + '😀', 'b']}
      ${'leaving out a blank part'}                          | ${line('a', LIMIT) + '\n' + 'b'.repeat(LIMIT + 1)}     | ${[line('a', LIMIT), 'b'.repeat(LIMIT), 'b']}
    `('cuts a long text $description', async ({ text, parts }) => {
      await bot.sendMessage(text);
      expect(sentTexts()).toEqual(parts);
    });

    it.each`
      description        | text
      ${'an empty text'} | ${''}
      ${'a blank text'}  | ${' \n'}
    `('sends nothing for $description', async ({ text }) => {
      await bot.sendMessage(text);
      expect(fetcher.post).not.toHaveBeenCalled();
    });

    describe('with a long batch of logs', () => {
      // Supervision's format: a header line per log, then its message (here an error with 0 to 6 stack frames)
      const batch = Array.from(
        { length: 200 },
        (_, i) => `• 2026-10-02T12:00:00.000Z [ERROR] (gekko)\nError: failure ${i}${'\n    at frame (src/file.ts:1:1)'.repeat(i % 7)}`,
      ).join('---\n');

      beforeEach(async () => {
        await bot.sendMessage(batch);
      });

      it('keeps every message within the limit', () => {
        expect(Math.max(...sentTexts().map(text => text.length))).toBeLessThanOrEqual(LIMIT);
      });

      it('ends every message but the last with a line break', () => {
        expect(sentTexts().filter((text, i, texts) => i < texts.length - 1 && !text.endsWith('\n'))).toEqual([]);
      });

      it('gives the batch back when the messages are concatenated', () => {
        expect(sentTexts().join('')).toBe(batch);
      });
    });

    it('does not send a part before the previous one is accepted', async () => {
      (fetcher.post as Mock).mockReturnValueOnce(new Promise(() => {})); // The first part is never accepted
      bot.sendMessage('a'.repeat(LIMIT + 1));
      await new Promise(resolve => setTimeout(resolve));
      expect(fetcher.post).toHaveBeenCalledTimes(1);
    });

    it('sends all the parts to one chat, even if a command comes in from another chat meanwhile', async () => {
      (fetcher.post as Mock).mockImplementationOnce(async () => {
        (bot as any).chatId = 99; // What checkUpdates does with a command from chat 99
      });
      await bot.sendMessage('a'.repeat(LIMIT + 1), 10);
      expect(sentPayloads().map(({ chat_id }) => chat_id)).toEqual([10, 10]);
    });

    describe('when a part fails', () => {
      const failure = new Error('HTTP 429 Too Many Requests: Too Many Requests: retry after 5');
      const threeParts = 'a'.repeat(2 * LIMIT + 1);

      beforeEach(() => {
        (fetcher.post as Mock).mockResolvedValueOnce({}).mockRejectedValueOnce(failure);
      });

      it('rejects with its error', async () => {
        await expect(bot.sendMessage(threeParts)).rejects.toBe(failure);
      });

      it('does not send the parts after it', async () => {
        await bot.sendMessage(threeParts).catch(() => undefined);
        expect(fetcher.post).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('checkUpdates', () => {
    it('should process commands via handleCommand', async () => {
      const handle = vi.fn().mockReturnValue('pong');
      bot = new TelegramBot(token, username, handle);
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [
          {
            update_id: 1,
            message: {
              text: '/ping@bot_name',
              chat: { id: 4 },
            },
          },
        ],
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
      bot = new TelegramBot(token, username, handle);
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [
          { update_id: 1 },
          {
            update_id: 2,
            message: {
              text: '/ping@bot_name',
              chat: { id: 7 },
            },
          },
        ],
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

    it('should not answer a command when there is no handleCommand', async () => {
      (fetcher.get as Mock).mockResolvedValue({
        ok: true,
        result: [{ update_id: 1, message: { text: '/ping@bot_name', chat: { id: 4 } } }],
      });
      bot.sendMessage = vi.fn();
      await (bot as any).checkUpdates();
      expect(bot.sendMessage).not.toHaveBeenCalled();
    });
  });
});
