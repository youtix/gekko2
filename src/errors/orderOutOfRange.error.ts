import { Tag } from '@models/tag.types';
import { isNil } from 'lodash-es';
import { GekkoError } from './gekko.error';

export class OrderOutOfRangeError extends GekkoError {
  constructor(tag: Tag, property: string, current: number, min?: number, max?: number) {
    const message =
      !isNil(min) && !isNil(max)
        ? `Order '${property}' with value ${current} is out of range. Expected a value between ${min} and ${max}.`
        : !isNil(min)
          ? `Order '${property}' with value ${current} is too low. Minimum allowed is ${min}.`
          : !isNil(max)
            ? `Order '${property}' with value ${current} is too high. Maximum allowed is ${max}.`
            : `Order '${property}' with value ${current} is out of range.`;

    super(tag, message);
    this.name = 'OrderOutOfRangeError';
  }
}
