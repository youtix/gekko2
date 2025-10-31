import { DummyExchange } from './exchange.types';

export const isDummyExchange = (exchange: unknown): exchange is DummyExchange =>
  typeof exchange === 'object' &&
  exchange &&
  'getExchangeName' in exchange &&
  typeof exchange.getExchangeName === 'function' &&
  exchange.getExchangeName().includes('dummy') &&
  'addCandle' in exchange &&
  typeof exchange.addCandle === 'function';
