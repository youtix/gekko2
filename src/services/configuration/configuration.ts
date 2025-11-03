import { GekkoError } from '@errors/gekko.error';
import { isDaterangeValid } from '@utils/date/date.utils';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import JSON5 from 'json5';
import { find } from 'lodash-es';
import { Configuration as ConfigurationModel } from '../../models/configuration.types';
import { configurationSchema } from './configuration.schema';

class Configuration {
  private configuration?: ConfigurationModel;
  constructor() {
    const configFilePath = process.env['GEKKO_CONFIG_FILE_PATH'];
    if (!configFilePath) throw new GekkoError('configuration', 'Missing GEKKO_CONFIG_FILE_PATH environment variable');
    const isJson = configFilePath?.endsWith('json') || configFilePath?.endsWith('json5');
    const isYaml = configFilePath?.endsWith('yml') || configFilePath?.endsWith('yaml');
    const data = readFileSync(configFilePath, 'utf8');
    if (isJson) this.configuration = JSON5.parse(data);
    else if (isYaml) this.configuration = load(data) as ConfigurationModel;
    this.configuration = configurationSchema.parse(this.configuration);
  }

  public showLogo() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    return this.configuration.showLogo;
  }

  public getPlugins() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    return this.configuration.plugins;
  }

  public getStrategy() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    return this.configuration.strategy;
  }

  public getWatch() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    const { daterange, mode } = this.configuration.watch;

    if (mode === 'importer' && daterange && !isDaterangeValid(daterange.start, daterange.end))
      throw new GekkoError('configuration', `Wrong date range: ${daterange.start} -> ${daterange.end}`);

    if (mode === 'backtest' && daterange && !isDaterangeValid(daterange.start, daterange.end))
      throw new GekkoError('configuration', `Wrong date range: ${daterange.start} -> ${daterange.end}`);

    return this.configuration.watch;
  }

  public getStorage() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    const { watch, plugins } = this.configuration;
    if (this.configuration.storage && (watch.mode === 'backtest' || find(plugins, { name: 'CandleWriter' }))) {
      return this.configuration.storage;
    }
  }

  public getExchange() {
    if (!this.configuration) throw new GekkoError('configuration', 'Empty configuration file');
    return this.configuration.exchange;
  }
}

export const config = new Configuration();
