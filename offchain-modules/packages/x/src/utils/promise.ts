export interface RetryPromiseOptions {
  /**
   * custom retry error handler
   * @param err
   * @param times
   */
  onRejected?: (err: unknown, errorTimes: number) => Promise<void> | void;
  /**
   * retry interval in millisecond, defaults to 300ms
   */
  onRejectedInterval?: number;
  maxRetryTimes?: number;
}

/**
 * sleep in millisecond
 * @param timeout
 */
export function asyncSleep(timeout: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, timeout));
}

export class TooManyRetriesError extends Error {
  public raw: unknown;

  constructor(times: number, error?: unknown) {
    const sinceMessage = error instanceof Error ? error.message : String(error || 'unknown error');
    super(`Retried ${times} times, too many retries, since: ${sinceMessage}`);

    this.raw = error;
  }
}

/**
 * retry promise when error found
 * @param promiseThunk
 * @param options
 */
export async function retryPromise<T>(promiseThunk: () => Promise<T>, options: RetryPromiseOptions = {}): Promise<T> {
  let errorTimes = 0;
  const { onRejectedInterval = 300, onRejected, maxRetryTimes = 5 } = options;

  function internal(): Promise<T> {
    return promiseThunk().catch(async (err: unknown) => {
      errorTimes++;
      if (onRejected) await onRejected(err, errorTimes);
      if (errorTimes <= maxRetryTimes) return asyncSleep(onRejectedInterval).then(internal);
      throw new TooManyRetriesError(errorTimes, err);
    });
  }

  return internal();
}

interface ForeverPromiseOptions {
  onRejected?: RetryPromiseOptions['onRejected'];
  onRejectedInterval: number;

  onResolvedInterval: number;
}

/**
 * endless promise loop
 * @param promiseThunk
 * @param options
 */
export function foreverPromise(promiseThunk: (times: number) => Promise<void>, options: ForeverPromiseOptions): void {
  const { onRejectedInterval, onResolvedInterval, onRejected } = options;

  (async () => {
    for (let times = 0; ; times++) {
      await retryPromise(() => promiseThunk(times), {
        maxRetryTimes: Infinity,
        onRejected: onRejected,
        onRejectedInterval: onRejectedInterval,
      });

      await asyncSleep(onResolvedInterval);
    }
  })();
}
