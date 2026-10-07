import { z } from 'zod';

/**
 * The chatId option of the Telegram plugins: the only chat whose commands the bot handles and that gets its messages (see
 * TelegramBot). A Telegram chat id is positive for a private chat and negative for a group, never 0: with 0, the bot would ignore
 * every command, its owner's included, and Telegram would refuse every message it sends ("chat not found").
 */
export const chatIdSchema = z
  .number()
  .int()
  .refine(
    chatId => chatId !== 0,
    'chatId cannot be 0, the id of no Telegram chat: a private chat has a positive id, a group a negative one',
  );
