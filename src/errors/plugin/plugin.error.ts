import { GekkoError } from '@errors/gekko.error';

export class PluginError extends GekkoError {
  constructor(pluginName: string, message: string) {
    super(pluginName, message);
    this.name = 'PluginError';
  }
}
