export type Undefined<T> = T | undefined;
export type Nullable<T> = T | null;
export type Minute = number;
export type HexString = `0x${string}`;
export type Asset = string;
export type Symbol = `${Asset}/${Asset}`;
export type Pair = [Asset, Asset];
