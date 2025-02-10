import { logger } from '../logger';
import { FETCHER_MAX_RETRIES } from './fetcher.const';
import { Fetcher } from './fetcher.types';

const post: Fetcher['post'] = async ({ payload, url, attempt = 0, retries = FETCHER_MAX_RETRIES }) => {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const contentType = response.headers.get('Content-Type');
    const isJson = contentType && contentType.includes('application/json');
    const data = isJson ? await response.json() : await response.text();

    if (!response.ok || data.ok === false) {
      const errorDetails = data.description || JSON.stringify(data);
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${errorDetails}`);
    }

    return data;
  } catch (error) {
  
    if (attempt >= retries) {
      if(error instanceof Error) logger.error(error.message);
      throw error;
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
    return post({ url, payload, retries, attempt: attempt + 1 });
  }
};

export const fetcher = { post };