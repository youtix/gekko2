import { PluginError } from './plugin.error';

export class PluginMissingServiceError extends PluginError {
  constructor(pluginName: string, serviceName: string) {
    super(
      pluginName,
      `Missing ${serviceName} in ${pluginName} plugin. Did you forget to inject it in getStaticConfiguration() ?`,
    );
    this.name = 'PluginMissingServiceError';
  }
}
