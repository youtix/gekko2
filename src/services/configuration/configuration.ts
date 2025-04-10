import { InvalidDateRangeError } from '@errors/invalidDateRange.error';
import { isDaterangeValid } from '@utils/date/date.utils';
import { readFileSync } from 'fs';
import { load } from 'js-yaml';
import JSON5 from 'json5';
import { find } from 'lodash-es';
import { MalformedConfigurationError } from '../../errors/malformedConfiguration.error';
import { MissingEnvVarError } from '../../errors/missingEnvVar.error';
import { configurationSchema } from '../../models/schema/configuration.schema';
import { Configuration as ConfigurationModel } from '../../models/types/configuration.types';

class Configuration {
  private configuration?: ConfigurationModel;
  constructor() {
    const configFilePath = process.env['CONFIG_FILE_PATH'];
    if (!configFilePath) throw new MissingEnvVarError('CONFIG_FILE_PATH');
    const isJson = configFilePath?.endsWith('json5') || configFilePath?.endsWith('json5');
    const isYaml = configFilePath?.endsWith('yml') || configFilePath?.endsWith('yaml');
    const data = readFileSync(configFilePath, 'utf8');
    if (isJson) this.configuration = JSON5.parse(data);
    else if (isYaml) this.configuration = load(data) as ConfigurationModel;
    this.configuration = configurationSchema.validateSync(this.configuration);
  }

  public showLogo() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    return this.configuration.showLogo;
  }

  public getPlugins() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    return this.configuration.plugins;
  }

  public getStrategy<T>() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    return this.configuration.strategy as T & { name: string };
  }

  public getWatch() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    const { daterange, scan, mode } = this.configuration.watch;

    if (mode === 'importer' && !isDaterangeValid(daterange.start, daterange.end))
      throw new InvalidDateRangeError(daterange.start, daterange.end);

    if (mode === 'backtest' && !scan && !isDaterangeValid(daterange.start, daterange.end))
      throw new InvalidDateRangeError(daterange.start, daterange.end);

    return this.configuration.watch;
  }

  public getStorage() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    const { watch, plugins } = this.configuration;
    if (this.configuration.storage && (watch.mode === 'backtest' || find(plugins, { name: 'CandleWriter' }))) {
      return this.configuration.storage;
    }
  }

  public getBroker() {
    if (!this.configuration) throw new MalformedConfigurationError('Empty configuration file');
    return this.configuration.broker;
  }
}

export const config = new Configuration();
