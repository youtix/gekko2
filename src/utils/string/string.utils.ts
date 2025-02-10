import { camelCase } from 'lodash-es';

export const toCamelCase = (...args: string[]) => {
  return camelCase(args.join(' '));
};
