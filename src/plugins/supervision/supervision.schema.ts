import { chatIdSchema } from '@services/bots/telegram/telegram.schema';
import { z } from 'zod';

/** setInterval treats a longer delay (2^31 - 1 ms, about 24.8 days) as an overflow and fires after 1 ms instead */
const MAX_TIMER_DELAY = 2_147_483_647;

/** The checks run at most once a second: a period of a few milliseconds would keep the bot busy measuring itself and flood Telegram */
const MIN_CHECK_INTERVAL = 1000;

/** A check period handed to setInterval, bounded like the exchange polling periods */
const checkIntervalSchema = (field: string) => {
  const message = `${field} must be an integer number of milliseconds between ${MIN_CHECK_INTERVAL} and ${MAX_TIMER_DELAY}`;
  return z.number(message).int(message).min(MIN_CHECK_INTERVAL, message).max(MAX_TIMER_DELAY, message);
};

export const supervisionSchema = z.strictObject({
  name: z.string(),
  token: z.string(),
  botUsername: z.string(),
  // The only chat whose commands the bot handles and that gets its messages. Anyone can find a bot by its username, and without
  // it the bot takes the first chat to send it a command after start-up.
  chatId: chatIdSchema.optional(),
  cpuThreshold: z.number().positive().default(80),
  memoryThreshold: z.number().positive().default(1024),
  cpuCheckInterval: checkIntervalSchema('cpuCheckInterval').default(10000),
  memoryCheckInterval: checkIntervalSchema('memoryCheckInterval').default(10000),
  logMonitoringInterval: checkIntervalSchema('logMonitoringInterval').default(60000),
});
