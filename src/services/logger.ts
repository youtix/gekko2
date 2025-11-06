import { Tag } from '@models/tag.types';
import { RingBuffer } from '@utils/collection/ringBuffer';
import { isString, upperCase } from 'lodash-es';
import { createLogger, format, transports } from 'winston';
import { BufferedLog, LogInput } from './logger.types';
const { combine, timestamp, json } = format;

const logBuffer = new RingBuffer<BufferedLog>(1000);

const logger = createLogger({
  level: process.env.GEKKO_LOG_LEVEL || 'error',
  format: combine(timestamp(), json()),
  transports: [new transports.Console()],
});

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
