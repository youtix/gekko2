import { getTime } from 'date-fns';
import { Candle } from './types/candle.types';

export const generateCandle = (candle?: Partial<Candle>): Candle => ({
  start: new Date('2024-06-01T00:00:00Z').getTime(),
  open: 100,
  high: 100,
  low: 100,
  close: 100,
  volume: 1,
  ...(candle && { ...candle }),
});

export const generateCandles = () => [
  generateCandle(),
  generateCandle({
    start: new Date('2024-06-01T00:02:00Z').getTime(),
    open: 102,
    high: 102,
    low: 102,
    close: 102,
  }),
  generateCandle({
    start: new Date('2024-06-01T00:06:00Z').getTime(),
    open: 104,
    high: 104,
    low: 104,
    close: 104,
    volume: 1,
  }),
];
export const candles = [
  {
    id: 1,
    start: getTime('2015-02-14T23:57:00.000Z'),
    open: 257.19,
    high: 257.19,
    low: 257.18,
    close: 257.18,
    volume: 0.97206065,
  },
  {
    id: 2,
    start: getTime('2015-02-14T23:58:00.000Z'),
    open: 257.02,
    high: 257.02,
    low: 256.98,
    close: 256.98,
    volume: 4.1407478,
  },
  {
    id: 3,
    start: getTime('2015-02-14T23:59:00.000Z'),
    open: 256.85,
    high: 256.99,
    low: 256.85,
    close: 256.99,
    volume: 6,
  },
  {
    id: 4,
    start: getTime('2015-02-15T00:00:00.000Z'),
    open: 256.81,
    high: 256.82,
    low: 256.81,
    close: 256.82,
    volume: 4,
  },
  {
    id: 5,
    start: getTime('2015-02-15T00:01:00.000Z'),
    open: 256.81,
    high: 257.02,
    low: 256.81,
    close: 257.01,
    volume: 6,
  },
  {
    id: 6,
    start: getTime('2015-02-15T00:02:00.000Z'),
    open: 257.03,
    high: 257.03,
    low: 256.33,
    close: 256.33,
    volume: 6.7551178,
  },
  {
    id: 7,
    start: getTime('2015-02-15T00:03:00.000Z'),
    open: 257.02,
    high: 257.47,
    low: 257.02,
    close: 257.47,
    volume: 3.7384995300000003,
  },
  {
    id: 8,
    start: getTime('2015-02-15T00:04:00.000Z'),
    open: 257.47,
    high: 257.48,
    low: 257.37,
    close: 257.38,
    volume: 8,
  },
  {
    id: 9,
    start: getTime('2015-02-15T00:05:00.000Z'),
    open: 257.38,
    high: 257.45,
    low: 257.38,
    close: 257.45,
    volume: 7.97062564,
  },
  {
    id: 10,
    start: getTime('2015-02-15T00:06:00.000Z'),
    open: 257.46,
    high: 257.48,
    low: 257.46,
    close: 257.48,
    volume: 7.5,
  },
];
