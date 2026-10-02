import { Tag } from '@models/tag.types';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { isString, upperCase } from 'lodash-es';
import { createLogger, format, transports } from 'winston';
import { BufferedLog, LogInput } from './logger.types';
const { combine, timestamp, json } = format;

const logBuffer = new RingBuffer<BufferedLog>(1000);

const DEFAULT_LOG_LEVEL = 'error';
// winston's npm levels. Not read from winston's `config`, which the e2e winston mock does not provide.
const LOG_LEVELS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'];

// winston accepts any level, and with an unknown one it silently drops every message
const resolveLogLevel = (value: string | undefined) => {
  if (!value) return { level: DEFAULT_LOG_LEVEL };
  const normalized = value.trim().toLowerCase();
  const level = normalized === 'warning' ? 'warn' : normalized;
  return LOG_LEVELS.includes(level) ? { level } : { level: DEFAULT_LOG_LEVEL, rejected: value };
};

const { level: logLevel, rejected: rejectedLogLevel } = resolveLogLevel(process.env.GEKKO_LOG_LEVEL);

const logger = createLogger({
  level: logLevel,
  format: combine(timestamp(), json()),
  transports: [new transports.Console()],
});

if (rejectedLogLevel !== undefined) {
  logger.log({
    level: 'error',
    message: `Invalid GEKKO_LOG_LEVEL '${rejectedLogLevel}', falling back to '${logLevel}'. Valid levels: ${LOG_LEVELS.join(', ')}.`,
    _tag: 'CONFIGURATION',
  });
}

const log = ({ tag, message, level }: LogInput) => {
  logBuffer.push({ timestamp: Date.now(), level, tag, message: isString(message) ? message : JSON.stringify(message) });
  logger.log({ level, message: message as string, _tag: upperCase(tag) });
};

export const debug = (tag: Tag, message: unknown) => {
  log({ tag, message, level: 'debug' });
};

export const info = (tag: Tag, message: unknown) => {
  log({ tag, message, level: 'info' });
};

export const warning = (tag: Tag, message: unknown) => {
  log({ tag, message, level: 'warn' });
};

export const error = (tag: Tag, message: unknown) => {
  log({ tag, message, level: 'error' });
};

export const getBufferedLogs = () => logBuffer.toArray();
