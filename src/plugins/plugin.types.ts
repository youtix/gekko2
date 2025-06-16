import * as plugins from './index';

export type PluginsNames = keyof typeof plugins;
export type PluginsDefinition = (args: ConstructorParameters<(typeof plugins)[PluginsNames]>) => typeof plugins;
