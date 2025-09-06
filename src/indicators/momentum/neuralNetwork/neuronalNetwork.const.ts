/** Small value to prevent division-by-zero/NaN in log-return calculation */
export const EPSILON = 1e-12;

/** Number of gradient steps per new data point in online learning */
export const TRAINING_EPOCHS = 3;

/** Hard cap for per-tick returns magnitude to reduce outlier impact */
export const CLIP = 0.05;

/** Number of most recent returns used to build rehearsal training pairs */
export const REHEARSE_WINDOW_SIZE = 32;

/** Training epochs applied to each rehearsal sample for consolidation */
export const REHEARSE_TRAINING_EPOCHS = 10;

/** Candles between rehearsal passes when `isRehearse` is enabled */
export const REHEARSE_INTERVAL = 50;
