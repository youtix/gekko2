export const round = (value: number, decimals = 0, option: 'down' | 'up' | 'halfEven' = 'up'): number => {
  const factor = 10 ** decimals;
  if (option === 'up') return Math.round(value * factor) / factor;
  if (option === 'down') return Math.floor(value * factor) / factor;
  const n = value * factor;
  const floor = Math.floor(n);
  const fraction = n - floor;
  if (fraction > 0.5) return (floor + 1) / factor;
  if (fraction < 0.5) return floor / factor;
  return (floor % 2 === 0 ? floor : floor + 1) / factor;
};
