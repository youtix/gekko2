import { PluginError } from './plugin.error';

export class PluginEmitEmptyEventError extends PluginError {
  constructor(pluginName: string, eventName: string) {
    super(
      pluginName,
      `Event name (${eventName}) or plugin name (${pluginName}) is/are missing when creating event.`,
    );
    this.name = 'PluginEmitEmptyEventError';
  }
}
