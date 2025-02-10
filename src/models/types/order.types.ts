const orderStatus = ['open', 'closed', 'canceled'] as const;

export type Order = {
  id: string;
  status: (typeof orderStatus)[number];
  filled?: number;
  remaining?: number;
  price?: number;
  timestamp: EpochTimeStamp;
};

export const isOrderStatus = (status?: string): status is Order['status'] =>
  orderStatus.includes(status as Order['status']);
