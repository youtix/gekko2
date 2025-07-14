import { isNil } from 'lodash-es';
import { PlainObject } from './object.types';

export const shallowObjectDiff = <T extends PlainObject, U extends PlainObject>(a: T, b: U): Partial<T & U> => {
  if (isNil(a) || isNil(b)) throw new TypeError('shallowObjectDiff expects two defined objects');

  const result: PlainObject = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]); // merge and remove duplicate keys

  keys.forEach(key => {
    if (!Object.is(a[key], b[key])) {
      // Prefer the value from `b` if present, else from `a`
      result[key] = key in b ? b[key] : a[key];
    }
  });

  return result as Partial<T & U>;
};
