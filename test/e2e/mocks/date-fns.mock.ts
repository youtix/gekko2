import { ONE_MINUTE } from '@constants/time.const';

export const mockDateFns = {
  startOfMinute: (date: number | Date) => {
    const timestamp = new Date(date).getTime();
    return new Date(Math.floor(timestamp / ONE_MINUTE) * ONE_MINUTE);
  },
  subMinutes: (date: number | Date, amount: number) => {
    return new Date(new Date(date).getTime() - amount * ONE_MINUTE);
  },
  addMinutes: (date: number | Date, amount: number) => {
    return new Date(new Date(date).getTime() + amount * ONE_MINUTE);
  },
  differenceInMinutes: (dateLeft: number | Date, dateRight: number | Date) => {
    const diff = new Date(dateLeft).getTime() - new Date(dateRight).getTime();
    return Math.floor(diff / ONE_MINUTE);
  },
  isSameMinute: (dateLeft: number | Date, dateRight: number | Date) => {
    const startLeft = Math.floor(new Date(dateLeft).getTime() / ONE_MINUTE);
    const startRight = Math.floor(new Date(dateRight).getTime() / ONE_MINUTE);
    return startLeft === startRight;
  },
};
