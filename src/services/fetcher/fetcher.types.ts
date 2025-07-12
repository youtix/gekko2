type RequestFetch = {
  url: string;
  payload?: unknown;
  retries?: number;
  attempt?: number;
};

export type Request = <T>({ payload, url, attempt, retries }: RequestFetch) => Promise<T>;

type PostFetch = {
  url: string;
  payload: unknown;
  retries?: number;
  attempt?: number;
};

type GetFetch = {
  url: string;
  retries?: number;
  attempt?: number;
};

export type Fetcher = {
  post: <T>({ payload, url, attempt, retries }: PostFetch) => Promise<T>;
  get: <T>({ url, attempt, retries }: GetFetch) => Promise<T>;
};
