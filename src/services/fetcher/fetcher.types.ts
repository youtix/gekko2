export type PostFetch = {
  url: string;
  payload: unknown;
  retries?: number;
  attempt?: number;
};

export type Fetcher = { post: <T>({ payload, url, attempt, retries }: PostFetch) => Promise<T> };
