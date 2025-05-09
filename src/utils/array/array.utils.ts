import { xor } from 'lodash-es';
import { SortedDirection } from './array.utils.types';

export const removeDuplicates = <T>(arr: T[]) => xor(...arr.map(a => [a]));
export const keepDuplicates = <T>(arr: T[]) => xor(arr, removeDuplicates(arr));

const comparators = {
  SAsc: (x: number, y: number) => x < y,
  Asc: (x: number, y: number) => x <= y,
  SDesc: (x: number, y: number) => x > y,
  Desc: (x: number, y: number) => x >= y,
} as const;

export const isSorted = (data: number[], direction: SortedDirection = 'SAsc') => {
  if (data.length < 2) return true;
  const cmp = comparators[direction];
  return data.every((v, i, arr) => !i || cmp(arr[i - 1], v));
};
