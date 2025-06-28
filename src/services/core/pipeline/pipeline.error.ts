import { GekkoError } from '@errors/gekko.error';

export class PluginsEmitSameEventError extends GekkoError {
  constructor(pluginNames: string[], events: string[]) {
    const plgNames = pluginNames.join(',');
    const evtNames = events.join(' ');
    super(
      'pipeline',
      `Multiple plugins (${plgNames}) are broadcasting the same event(s) (${evtNames}). This is unsupported`,
    );
    this.name = 'PluginsEmitSameEventError';
  }
}
