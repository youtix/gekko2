import { EnvVariables } from '../models/types/env.types';

export class MissingEnvVarError extends Error {
  constructor(missingVariable: EnvVariables) {
    super(`missing ${missingVariable} environment variable`);
    this.name = 'MissingEnvVarError';
  }
}
