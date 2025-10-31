import { z } from 'zod';
import { eventSubscriberSchema } from './eventSubscriber.schema';

export const EVENT_NAMES = [
  'strategy_info',
  'strategy_advice',
  'order_initiated',
  'order_canceled',
  'order_aborted',
  'order_errored',
  'order_completed',
] as const;

export type Event = (typeof EVENT_NAMES)[number];

export type EventSubscriberConfig = z.infer<typeof eventSubscriberSchema>;
