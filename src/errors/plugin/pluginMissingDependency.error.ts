import { PluginError } from './plugin.error';

export class PluginMissingDependencyError extends PluginError {
  constructor(pluginName: string, moduleName: string) {
    super(pluginName, `Dependency ${moduleName} not installed for plugin ${pluginName}`);
    this.name = 'PluginMissingDependencyError';
  }
}
