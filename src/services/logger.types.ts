import { LogLevel } from '@models/logLevel.types';
import { Tag } from '@models/tag.types';

export type LogInput = { tag: Tag; message: unknown; level: LogLevel };
export type BufferedLog = { timestamp: number; level: LogLevel; tag: Tag; message: string };
