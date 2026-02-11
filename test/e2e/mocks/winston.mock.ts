export const MockWinstonLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  verbose: () => {},
  silly: () => {},
  log: () => {},
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
