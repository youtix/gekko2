import { upperCase } from 'lodash-es';

export class GekkoError extends Error {
  constructor(tag: string, message: string) {
    super(`[${upperCase(tag)}] ${message}`);
    this.name = 'GekkoError';
  }
}
