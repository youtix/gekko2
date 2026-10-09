import { xor } from 'lodash-es';

export const removeDuplicates = <T>(arr: T[]) => xor(...arr.map(a => [a]));
export const keepDuplicates = <T>(arr: T[]) => xor(arr, removeDuplicates(arr));
