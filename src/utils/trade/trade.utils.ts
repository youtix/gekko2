import { Order } from '@models/order.types';
import { Trade } from '@models/trade.types';
import { map, pick } from 'lodash-es';

export const mapToTrades = (trades: unknown[]) =>
  map(trades, trade => pick(trade, ['amount', 'price', 'timestamp', 'id', 'fee'])) as Trade[];

export const mapToOrder = (order: unknown): Order =>
  pick(order, ['id', 'status', 'filled', 'remaining', 'price', 'timestamp']) as Order;
