export class PluginError extends Error {
  constructor(pluginName: string, message: string) {
    super(`[${pluginName}] ${message}`);
    this.name = 'PluginError';
  }
}
