import { secondsToMilliseconds } from 'date-fns';
import packageJson from '../../../package.json';

export const logVersion = () =>
  `Gekko version: v${packageJson.version}, Bun version: ${process.version}`;

export const processStartTime = (): EpochTimeStamp => {
  return Date.now() - secondsToMilliseconds(process.uptime());
};

export const wait = (waitingTime: number) =>
  new Promise(resolve => setTimeout(resolve, waitingTime));
