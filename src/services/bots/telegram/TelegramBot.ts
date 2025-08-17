import { fetcher } from '@services/fetcher/fetcher.service';
import { debug } from '@services/logger';
import { pluralize } from '@utils/string/string.utils';
import { isString } from 'lodash-es';
import { Bot } from '../Bot';
import { HandleCommand } from '../bots.types';
import { TelegramUpdate } from './telegram.types';

export class TelegramBot extends Bot {
  private readonly apiUrl: string;
  private offset = 0;
  private chatId?: number;

  constructor(token: string, handleCommand?: HandleCommand) {
    super(handleCommand);
    this.apiUrl = `https://api.telegram.org/bot${token}`;
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.apiUrl}/getUpdates?timeout=50&offset=${this.offset + 1}`;
    const data = await fetcher.get<{ ok: boolean; result: TelegramUpdate[] }>({ url });
    if (!data.ok) return [];
    if (data.result.length > 0) this.offset = data.result[data.result.length - 1].update_id;

    return data.result;
  }

  public async sendMessage(text: string, chatId?: number) {
    await fetcher.post({
      url: `${this.apiUrl}/sendMessage`,
      payload: { chat_id: this.chatId ?? chatId, text },
    });
  }

  protected async checkUpdates(): Promise<void> {
    const updates = await this.fetchUpdates();
    debug('bot', `Received ${updates.length} ${pluralize('update', updates.length)} from Telegram Bot`);
    for (const update of updates) {
      const message = update.message;
      if (!message || !isString(message.text)) continue;
      const { text, chat } = message;
      const cmd = text;
      debug('bot', `Received command from Telegram Bot: "${cmd}"`);
      this.chatId = chat.id;
      if (this.handleCommand && cmd.startsWith('/')) await this.sendMessage(this.handleCommand(cmd));
    }
  }
}
