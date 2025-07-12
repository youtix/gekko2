import { error } from '@services/logger';
import { wait } from '@utils/process/process.utils';
import { FETCHER_MAX_RETRIES } from './fetcher.const';
import { Fetcher, Request } from './fetcher.types';

const request: Request = async ({ url, payload, attempt = 0, retries = FETCHER_MAX_RETRIES }) => {
  try {
    const config = payload
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      : undefined;

    const response = await fetch(url, config);

    const contentType = response.headers.get('Content-Type');
    const isJson = contentType && contentType.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok || data.ok === false) {
      const errorDetails = data.description || JSON.stringify(data);
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorDetails}`);
    }

    return data;
  } catch (err) {
    if (attempt >= retries) {
      if (err instanceof Error) error('fetcher', err.message);
      throw err;
    }

    await wait(1000 * (attempt + 1));
    return request({ url, payload, retries, attempt: attempt + 1 });
  }
};

export const fetcher: Fetcher = { post: request, get: request };
