import { Tag } from '@models/types/tag.types';
import { RingBuffer } from '@utils/array/ringBuffer';
import { upperCase } from 'lodash-es';
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
  const msg = String(message);
  logBuffer.push({ timestamp: Date.now(), level, tag, message: msg });
  logger.log({ level, message: msg, _tag: upperCase(tag) });
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
