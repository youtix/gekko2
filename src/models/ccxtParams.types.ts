export type CcxtParams = {
  /**
   * Indicates that the user wants to paginate through different pages to get more data.
   * Default is false.
   */
  paginate?: boolean;

  /**
   * Allows the user to control the maximum amount of requests to paginate the data.
   * Due to the rate limits, this value should not be too high. Default is 10.
   */
  paginationCalls?: number;

  /**
   * How many times should the pagination mechanism retry upon getting an error.
   * Default is 3
   */
  maxRetries?: number;

  /**
   * Only applies to the dynamic pagination and it can be either forward
   * (start the pagination from some time in the past and paginate forward)
   * or backward (start from the most recent time and paginate backward).
   * If forward is selected then a since parameter must also be provided.
   * Default is backward.
   */
  paginationDirection?: 'forward' | 'backward';

  /**
   * The max amount of entries per request so that we can maximize the data retrieved per call.
   * It varies from endpoint to endpoint and CCXT will populate this value for you,
   * but you can override it if needed.
   */
  maxEntriesPerRequest?: number;
};
