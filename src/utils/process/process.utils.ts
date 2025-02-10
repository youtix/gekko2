import packageJson from '../../../package.json';

export const logVersion = () =>
  `Gekko version: v${packageJson.version}, Bun version: ${process.version}`;
