import { Tag } from '@models/types/tag.types';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogInput = { tag: Tag; message: unknown; level: LogLevel };
export type BufferedLog = { timestamp: number; level: LogLevel; tag: Tag; message: string };
