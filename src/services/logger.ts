import { Tag } from '@models/types/tag.types';
import { upperCase } from 'lodash-es';
import { createLogger, format, transports } from 'winston';
const { combine, timestamp, json } = format;

type LogInput = { tag: Tag; message: unknown; level: string };

const logger = createLogger({
  level: process.env.GEKKO_LOG_LEVEL || 'error',
  format: combine(timestamp(), json()),
  transports: [new transports.Console()],
});

const log = ({ tag, message, level }: LogInput) =>
  logger.log({ level, message: message as string, _tag: upperCase(tag) });

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
