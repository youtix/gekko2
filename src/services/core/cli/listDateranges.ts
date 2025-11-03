import { inject } from '@services/injecter/injecter';
import { toISOString } from '@utils/date/date.utils';

export const listAvailableDateRanges = () => {
  const storage = inject.storage();
  const ranges = storage.getCandleDateranges();

  if (!ranges || ranges.length === 0) {
    // eslint-disable-next-line no-console
    console.log('No date ranges found.');
    storage.close();
    return;
  }

  // eslint-disable-next-line no-console
  console.log('Available date ranges:');
  for (const range of ranges) {
    // eslint-disable-next-line no-console
    console.log(`-> ${toISOString(range.daterange_start)} - ${toISOString(range.daterange_end)}`);
  }

  storage.close();
};
