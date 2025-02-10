import { PluginError } from './plugin.error';

export class PluginsEmitSameEventError extends PluginError {
  constructor(pluginNames: string[], events: string[]) {
    const plgNames = pluginNames.join(',');
    const evtNames = events.join(' ');
    super(
      plgNames,
      `Multiple plugins (${plgNames}) are broadcasting the same event(s) (${evtNames}). This is unsupported`,
    );
    this.name = 'PluginsEmitSameEventError';
  }
}
