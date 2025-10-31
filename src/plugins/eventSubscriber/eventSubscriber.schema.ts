import { z } from 'zod';

export const eventSubscriberSchema = z.object({
  name: z.string(),
  token: z.string(),
  botUsername: z.string(),
});
