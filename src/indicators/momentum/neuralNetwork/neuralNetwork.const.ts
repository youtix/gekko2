/** Small value to prevent division-by-zero/NaN in log-return calculation */
export const EPSILON = 1e-12;

/** Hard cap for per-tick returns magnitude to reduce outlier impact */
export const CLIP = 0.05;
