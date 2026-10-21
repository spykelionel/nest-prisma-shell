/**
 * Rejects when `promise` has not settled within `ms`. Bounds calls to a
 * dependency that can hang (a Redis that never becomes ready, a stalled
 * socket) so they cannot hold an HTTP request open.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = 'operation',
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
