import { afterEach, describe, expect, it, vi } from 'vitest';
import { error } from '../logger';
import { fetcher } from './fetcher.service';

vi.mock('@services/logger', () => ({ debug: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() }));
vi.useFakeTimers();

describe('fetcher.post', () => {
  const dummyUrl = 'https://dummy.url';
  const payload = { test: 'data' };

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should return JSON data if response is ok and content type is application/json', async () => {
    const fakeData = { ok: true, result: 'success' };
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(fakeData),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(fakeResponse);
    const result = await fetcher.post({ url: dummyUrl, payload });
    expect(result).toEqual(fakeData);
  });

  it('should return text data if response is ok and content type is not application/json', async () => {
    const fakeText = 'plain text';
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve(fakeText),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(fakeResponse);
    const result = await fetcher.post({ url: dummyUrl, payload });
    expect(result).toEqual(fakeText);
  });

  it('should throw an error if response is not ok', async () => {
    const badResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'error description' }),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);
    await expect(fetcher.post({ url: dummyUrl, payload, retries: 0 })).rejects.toThrow(
      'HTTP 400 Bad Request: error description',
    );
  });

  it('should retry on failure and eventually return successful response', async () => {
    const fakeData = { ok: true, result: 'success after retry' };
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'server error' }),
    } as unknown as Response;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(fakeData),
    } as unknown as Response;

    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(errorResponse);
      }
      return Promise.resolve(successResponse);
    });
    const promise = fetcher.post({ url: dummyUrl, payload, retries: 2, attempt: 0 });
    await vi.advanceTimersByTimeAsync(1000); // first retry delay
    const result = await promise;
    expect(result).toEqual(fakeData);
  });

  it('should throw error after maximum retries are exceeded', async () => {
    const badResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'error description' }),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);
    const promise = fetcher.post({ url: dummyUrl, payload, retries: 1, attempt: 0 });
    vi.advanceTimersByTimeAsync(1000); // first retry delay
    try {
      await expect(promise).toThrowError('HTTP 400 Bad Request: error description');
    } catch {
      // error is expected
    }
  });

  it('should log error after maximum retries are exceeded', async () => {
    const badResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'error description' }),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);
    const promise = fetcher.post({ url: dummyUrl, payload, retries: 1, attempt: 0 });
    vi.advanceTimersByTimeAsync(1000); // wait for retry delay
    try {
      await promise;
    } catch {
      // error is expected
    }
    expect(error).toHaveBeenCalledWith('fetcher', 'HTTP 400 Bad Request: error description');
  });
});

describe('fetcher.get', () => {
  const dummyUrl = 'https://dummy.url';

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('should return JSON data if response is ok and content type is application/json', async () => {
    const fakeData = { ok: true, result: 'success' };
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(fakeData),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(fakeResponse);
    const result = await fetcher.get({ url: dummyUrl });
    expect(result).toEqual(fakeData);
  });

  it('should return text data if response is ok and content type is not application/json', async () => {
    const fakeText = 'plain text';
    const fakeResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'text/plain' },
      text: () => Promise.resolve(fakeText),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(fakeResponse);
    const result = await fetcher.get({ url: dummyUrl });
    expect(result).toEqual(fakeText);
  });

  it('should throw an error if response is not ok', async () => {
    const badResponse = {
      ok: false,
      status: 404,
      statusText: 'Not Found',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'not found' }),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);
    await expect(fetcher.get({ url: dummyUrl, retries: 0 })).rejects.toThrow('HTTP 404 Not Found: not found');
  });

  it('should retry on failure and eventually return successful response', async () => {
    const fakeData = { ok: true, result: 'success after retry' };
    const errorResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'server error' }),
    } as unknown as Response;
    const successResponse = {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve(fakeData),
    } as unknown as Response;

    let callCount = 0;
    vi.spyOn(global, 'fetch').mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve(errorResponse);
      }
      return Promise.resolve(successResponse);
    });
    const promise = fetcher.get({ url: dummyUrl, retries: 2, attempt: 0 });
    await vi.advanceTimersByTimeAsync(1000); // first retry delay
    const result = await promise;
    expect(result).toEqual(fakeData);
  });

  it('should log error after maximum retries are exceeded', async () => {
    const badResponse = {
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      headers: { get: () => 'application/json' },
      json: () => Promise.resolve({ ok: false, description: 'error description' }),
    } as unknown as Response;
    vi.spyOn(global, 'fetch').mockResolvedValue(badResponse);
    const promise = fetcher.get({ url: dummyUrl, retries: 1, attempt: 0 });
    vi.advanceTimersByTimeAsync(1000); // wait for retry delay
    try {
      await promise;
    } catch {
      // error is expected
    }
    expect(error).toHaveBeenCalledWith('fetcher', 'HTTP 400 Bad Request: error description');
  });
});
