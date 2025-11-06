export const DEFAULT_SIMULATION_BALANCE = {
  asset: 0,
  currency: 1000,
};

export const DEFAULT_LIMITS = {
  price: {
    min: 1,
    max: 1_000_000,
  },
  amount: {
    min: 0.0001,
    max: 1_000,
  },
  cost: {
    min: 10,
    max: 1_000_000,
  },
};

export const DEFAULT_TICKER = {
  bid: 100,
  ask: 101,
};
