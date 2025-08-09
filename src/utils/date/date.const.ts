import { setHours, setMilliseconds, setMinutes, setSeconds } from 'date-fns';

export const dateFnsMapper = {
  h: setHours,
  m: setMinutes,
  s: setSeconds,
  ms: setMilliseconds,
} as const;

export const MINUTE_MS = 60_000;
