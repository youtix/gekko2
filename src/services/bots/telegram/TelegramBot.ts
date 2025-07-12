import { fetcher } from '@services/fetcher/fetcher.service';
import { bindAll, isString } from 'lodash-es';
import { Bot } from '../Bot';
import { HandleCommand } from '../bots.types';
import { TelegramUpdate } from './telegram.types';

export class TelegramBot extends Bot {
  private readonly apiUrl: string;
  private offset = 0;

  constructor(token: string, handleCommand?: HandleCommand) {
    super(handleCommand);
    this.apiUrl = `https://api.telegram.org/bot${token}`;

    bindAll(this, ['checkUpdates']);
  }

  private async fetchUpdates(): Promise<TelegramUpdate[]> {
    const url = `${this.apiUrl}/getUpdates?timeout=30&offset=${this.offset + 1}`;
    const data = await fetcher.get<{ ok: boolean; result: TelegramUpdate[] }>({ url });
    if (!data.ok) return [];
    if (data.result.length > 0) this.offset = data.result[data.result.length - 1].update_id;

    return data.result;
  }

  public async sendMessage(chatId: number, text: string) {
    await fetcher.post({
      url: `${this.apiUrl}/sendMessage`,
      payload: { chat_id: chatId, text },
    });
  }

  protected async checkUpdates(): Promise<void> {
    const updates = await this.fetchUpdates();
    for (const update of updates) {
      const message = update.message;
      if (!message || !isString(message.text)) return;
      const { text, chat } = message;
      const responseText = this.handleCommand && text.startsWith('/') ? this.handleCommand(text) : text;

      await this.sendMessage(chat.id, responseText);
    }
  }
}
