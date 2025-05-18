import { secondsToMilliseconds } from 'date-fns';
import packageJson from '../../../package.json';

export const logVersion = () => `Gekko version: v${packageJson.version}, Bun version: ${process.version}`;

export const processStartTime = (): EpochTimeStamp => {
  return Date.now() - secondsToMilliseconds(process.uptime());
};

export const wait = (waitingTime: number) => new Promise(resolve => setTimeout(resolve, waitingTime));
export const waitSync = (ms: number) => {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
};
