import { Watch } from '@models/types/configuration.types';
import { PluginError } from './plugin.error';

export class PluginUnsupportedModeError extends PluginError {
  constructor(pluginName: string, mode: Watch['mode']) {
    super(pluginName, `Plugin ${pluginName} does not support ${mode} mode.`);
    this.name = 'PluginUnsupportedModeError';
  }
}
