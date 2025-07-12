import { GekkoError } from '@errors/gekko.error';
import { pluralize } from '@utils/string/string.utils';

export class PluginsEmitSameEventError extends GekkoError {
  constructor(pluginNames: string[], events: string[]) {
    const plgNames = pluginNames.join(',');
    const evtNames = events.join(' ');
    super(
      'pipeline',
      `Multiple plugins (${plgNames}) are broadcasting the same ${pluralize('event', evtNames.length)}: ${evtNames}. This behavior is unsupported.`,
    );
    this.name = 'PluginsEmitSameEventError';
  }
}
