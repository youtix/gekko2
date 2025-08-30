import { Tag } from '@models/tag.types';
import { upperCase } from 'lodash-es';

export class GekkoError extends Error {
  constructor(tag: Tag, message: string) {
    super(`[${upperCase(tag)}] ${message}`);
    this.name = 'GekkoError';
  }
}
