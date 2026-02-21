import { LogLevel } from '@models/logLevel.types';
import { Tag } from '@models/tag.types';

export const logStore: any[] = [];

export const clearLogs = () => {
  logStore.length = 0;
};

export const MockWinstonLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  verbose: () => {},
  silly: () => {},
  log: (message: { level: LogLevel; message: string; tag: Tag }) => {
    logStore.push(message);
  },
  add: () => {},
  remove: () => {},
  clear: () => {},
  close: () => {},
  child: () => MockWinstonLogger,
};

export const MockWinstonTransport = class {
  constructor() {}
};

export const MockWinstonFormat = {
  combine: () => {},
  timestamp: () => {},
  label: () => {},
  json: () => {},
  printf: () => {},
  colorize: () => {},
  simple: () => {},
  splat: () => {},
  ms: () => {},
  metadata: () => {},
  padLevels: () => {},
  prettyPrint: () => {},
};

export const MockWinston = {
  createLogger: () => MockWinstonLogger,
  transports: {
    Console: MockWinstonTransport,
    File: MockWinstonTransport,
    Http: MockWinstonTransport,
    Stream: MockWinstonTransport,
  },
  format: MockWinstonFormat,
};
