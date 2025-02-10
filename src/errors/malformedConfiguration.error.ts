export class MalformedConfigurationError extends Error {
  constructor(message: string) {
    super(`Malformed configuration file: ${message}`);
    this.name = 'MalformedConfigurationError';
  }
}
