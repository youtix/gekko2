export const getRetryDelay = (attempt: number, baseDelay: number = 1000, maxDelay: number = 3000) =>
  Math.min(baseDelay * Math.log2(attempt + 2), maxDelay);
