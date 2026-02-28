export const depthFirstSearch = (node: unknown, callback: (value: string | number | boolean) => void): void => {
  if (isNative(node)) return callback(node);
  if (node === null) return;
  if (Array.isArray(node)) for (const item of node) depthFirstSearch(item, callback);
  if (['object'].includes(typeof node)) {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      depthFirstSearch((node as Record<string, unknown>)[key], callback);
    }
  }
};

export const collectPrimitives = (value: unknown): string[] => {
  const pieces: string[] = [];
  depthFirstSearch(value, v => pieces.push(String(v)));
  return pieces;
};

export const generateStrategyId = (input: unknown): string => {
  return collectPrimitives(input).join('-');
};

export const isNative = (node: unknown): node is string | number | boolean => ['string', 'number', 'boolean'].includes(typeof node);
