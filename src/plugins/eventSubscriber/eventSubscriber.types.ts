import { z } from 'zod';
import { eventSubscriberSchema } from './eventSubscriber.schema';

export const EVENT_NAMES = [
  'strategy_info',
  'strategy_advice',
  'trade_initiated',
  'trade_canceled',
  'trade_aborted',
  'trade_errored',
  'trade_completed',
] as const;

export type Event = (typeof EVENT_NAMES)[number];

export type EventSubscriberConfig = z.infer<typeof eventSubscriberSchema>;
