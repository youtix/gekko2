import { addMinutes, differenceInMinutes, isBefore, isValid, startOfMinute, subMilliseconds } from 'date-fns';
import { isNil } from 'lodash-es';

export const toISOString = (timestamp?: EpochTimeStamp): string => (!isNil(timestamp) ? new Date(timestamp).toISOString() : 'Unknown Date');

export const toTimestamp = (iso8601String?: string): EpochTimeStamp => new Date(iso8601String ?? 0).getTime();

export const isDaterangeValid = (start: EpochTimeStamp, end: EpochTimeStamp) => {
  return isValid(start) && isValid(end) && isBefore(start, end);
};

export const splitIntervals = (startDate: EpochTimeStamp, endDate: EpochTimeStamp, batchSize = 1440) => {
  const alignedStart = startOfMinute(new Date(startDate));
  const alignedEnd = subMilliseconds(addMinutes(startOfMinute(new Date(endDate)), 1), 1);
  const totalMinutes = differenceInMinutes(alignedEnd, alignedStart) + 1;

  const chunkMaxDuration = batchSize;
  const chunkCount = Math.ceil(totalMinutes / chunkMaxDuration);
  const remainder = chunkCount === 1 ? totalMinutes : totalMinutes % chunkMaxDuration || chunkMaxDuration;

  return Array.from({ length: chunkCount }, (_, i) => {
    const minutesInChunk = i === chunkCount - 1 ? remainder : chunkMaxDuration;
    const chunkStart = addMinutes(alignedStart, i * chunkMaxDuration);
    const chunkEnd = subMilliseconds(addMinutes(chunkStart, minutesInChunk).getTime(), 1);

    return {
      start: chunkStart.getTime(),
      end: chunkEnd.getTime(),
    };
  });
};
