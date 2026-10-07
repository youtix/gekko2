/** The part of a Telegram message the bot reads (https://core.telegram.org/bots/api#message): Telegram sends more */
export interface TelegramMessage {
  text?: string;
  chat: {
    id: number;
    /** 'private', 'group', 'supergroup' or 'channel' */
    type?: string;
    /** The name of a group, a supergroup or a channel */
    title?: string;
    /** The username of a private chat's user, a supergroup or a channel, if it has one */
    username?: string;
  };
  /** The sender, which a message posted in a channel has not */
  from?: {
    username?: string;
    first_name?: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}
