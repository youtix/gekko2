import { secondsToMilliseconds } from 'date-fns';
import packageJson from '../../../package.json';

export const logVersion = () => {
  // Under Bun, process.version is the Node version Bun emulates, not Bun's own version.
  const runtime = process.versions.bun ? `Bun version: v${process.versions.bun}` : `Node version: ${process.version}`;
  return `Gekko version: v${packageJson.version}, ${runtime}`;
};

export const processStartTime = (): EpochTimeStamp => {
  return Date.now() - secondsToMilliseconds(process.uptime());
};

export const wait = (waitingTime: number) => new Promise(resolve => setTimeout(resolve, waitingTime));
export const waitSync = (ms: number) => {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
};
