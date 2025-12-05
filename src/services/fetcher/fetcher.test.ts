import { error } from '@services/logger';
import { describe, expect, it, vi } from 'vitest';
import { fetcher } from './fetcher.service';

vi.mock('@services/logger', () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));

vi.useFakeTimers();

describe('fetcher', () => {
  const dummyUrl = 'https://dummy.url';
  const payload = { test: 'data' };

  describe.each([
    { method: 'post', action: (retries = 0) => fetcher.post({ url: dummyUrl, payload, retries }) },
    { method: 'get', action: (retries = 0) => fetcher.get({ url: dummyUrl, retries }) },
  ])('$method', ({ action }) => {
    it.each`
      contentType           | responseBody                  | expected
      ${'application/json'} | ${{ ok: true, result: 'ok' }} | ${{ ok: true, result: 'ok' }}
      ${'text/plain'}       | ${'plain text'}               | ${'plain text'}
    `('should return result when content-type is $contentType', async ({ contentType, responseBody, expected }) => {
      const mockResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => contentType },
        json: () => Promise.resolve(responseBody),
        text: () => Promise.resolve(responseBody),
      } as unknown as Response;

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const result = await action();
      expect(result).toEqual(expected);
    });

    it.each`
      status | statusText        | responseBody                             | errorMsg
      ${400} | ${'Bad Request'}  | ${{ ok: false, description: 'error' }}   | ${'HTTP 400 Bad Request: error'}
      ${404} | ${'Not Found'}    | ${{ ok: false, description: 'missing' }} | ${'HTTP 404 Not Found: missing'}
      ${500} | ${'Server Error'} | ${{ ok: false }}                         | ${'HTTP 500 Server Error: {"ok":false}'}
    `('should throw error for status $status', async ({ status, statusText, responseBody, errorMsg }) => {
      const mockResponse = {
        ok: false,
        status,
        statusText,
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(responseBody),
      } as unknown as Response;

      vi.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      await expect(action(0)).rejects.toThrow(errorMsg);
    });

    it('should retry on failure and return success', async () => {
      const successData = { ok: true, result: 'success' };
      const errorResponse = {
        ok: false,
        status: 500,
        statusText: 'Error',
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ ok: false }),
      } as unknown as Response;
      const successResponse = {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve(successData),
      } as unknown as Response;

      let calls = 0;
      vi.spyOn(global, 'fetch').mockImplementation(() => {
        calls++;
        return Promise.resolve(calls === 1 ? errorResponse : successResponse);
      });

      const promise = action(2);
      await vi.advanceTimersByTimeAsync(1000);
      const result = await promise;

      expect(result).toEqual(successData);
    });

    it('should throw and log error after max retries exceeded', async () => {
      const errorResponse = {
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        headers: { get: () => 'application/json' },
        json: () => Promise.resolve({ ok: false, description: 'fail' }),
      } as unknown as Response;

      vi.spyOn(global, 'fetch').mockResolvedValue(errorResponse);

      // We attach a catch handler to avoid "Unhandled Rejection" during timer advancement
      // if the promise rejects before we await it.
      const promise = action(1).catch(e => e);

      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('HTTP 400 Bad Request: fail');
      expect(error).toHaveBeenCalledWith('fetcher', 'HTTP 400 Bad Request: fail');
    });
  });
});
