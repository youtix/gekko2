import { GekkoError } from '@errors/gekko.error';

export class StorageError extends GekkoError {
  constructor(message: string) {
    super('storage', message);
    this.name = 'StorageError';
  }
}
