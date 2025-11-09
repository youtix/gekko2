import { DummyExchange } from './exchange.types';

export const isDummyExchange = (exchange: unknown): exchange is DummyExchange =>
  typeof exchange === 'object' &&
  exchange &&
  'getExchangeName' in exchange &&
  typeof exchange.getExchangeName === 'function' &&
  exchange.getExchangeName().includes('dummy') &&
  'processOneMinuteCandle' in exchange &&
  typeof exchange.processOneMinuteCandle === 'function';
