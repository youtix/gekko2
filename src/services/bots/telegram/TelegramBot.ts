import { fetcher } from '@services/fetcher/fetcher.service';
import { debug } from '@services/logger';
import { pluralize } from '@utils/string/string.utils';
import { isString } from 'lodash-es';
import { Bot } from '../Bot';
import { HandleCommand } from '../bots.types';
import { TelegramUpdate } from './telegram.types';

// Bot API, sendMessage: a text of "1-4096 characters after entities parsing" (https://core.telegram.org/bots/api#sendmessage).
// Compared with String.length, which counts UTF-16 code units: never fewer than the characters.
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Cuts a text into consecutive slices that each fit in a message: concatenated, they give the text back. A slice ends just
 * after the last line break in reach, so that log lines and stack frames stay whole. A line longer than a message is cut at
 * the limit, or one code unit short of it when a surrogate pair (an emoji, say) straddles it.
 */
const splitIntoMessages = (text: string) => {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > MAX_MESSAGE_LENGTH) {
    const lineEnd = rest.lastIndexOf('\n', MAX_MESSAGE_LENGTH - 1) + 1; // 0 when no line break is in reach
    const straddles = rest.codePointAt(MAX_MESSAGE_LENGTH - 1)! > 0xffff; // A pair starts on the last code unit in reach
    const end = lineEnd > 0 ? lineEnd : straddles ? MAX_MESSAGE_LENGTH - 1 : MAX_MESSAGE_LENGTH;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  return [...parts, rest];
};

export class TelegramBot extends Bot {
  private readonly apiUrl: string;
  private offset = 0;
  private chatId?: number;
  private readonly botUsername: string;

  constructor(token: string, botUsername: string, handleCommand?: HandleCommand) {
    super(handleCommand);
    this.apiUrl = `https://api.telegram.org/bot${token}`;
    this.botUsername = botUsername;
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.apiUrl}/getUpdates?timeout=50&offset=${this.offset + 1}`;
    const data = await fetcher.get<{ ok: boolean; result: TelegramUpdate[] }>({ url });
    if (!data.ok) return [];
    if (data.result.length > 0) this.offset = data.result[data.result.length - 1].update_id;

    return data.result;
  }

  /**
   * A text longer than a message goes out as several, in order, each once the previous one is accepted. If one fails, this
   * rejects with its error and the parts after it are not sent.
   */
  public async sendMessage(text: string, chatId?: number) {
    // Read once: a command from another chat, received while the parts go out, must not divert the rest of them
    const target = this.chatId ?? chatId;
    for (const part of splitIntoMessages(text)) {
      // Never a blank message: Telegram refuses an empty text, and a blank one would show nothing
      if (!part.trim()) continue;
      await fetcher.post({
        url: `${this.apiUrl}/sendMessage`,
        payload: { chat_id: target, text: part },
      });
    }
  }

  protected async checkUpdates(): Promise<void> {
    const updates = await this.fetchUpdates();
    debug('bot', `Received ${updates.length} ${pluralize('update', updates.length)} from Telegram Bot`);
    for (const update of updates) {
      const message = update.message;
      if (!message || !isString(message.text)) continue;
      const { text, chat } = message;
      this.chatId = chat.id;
      // Expect format: /cmd@botUsername
      const [cmd, botName] = text.split('@');
      if (!botName || !cmd || botName !== this.botUsername) continue;
      if (this.handleCommand) {
        const response = this.handleCommand(cmd);
        await this.sendMessage(response);
      }
    }
  }
}
