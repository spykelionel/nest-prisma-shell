import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  /** Correlates every log line of one request or one job attempt. */
  traceId: string;
  /** Set once a request is authenticated. */
  userId?: string;
}

/**
 * Per-request (or per-job) state, readable anywhere without threading it
 * through call signatures. Node's AsyncLocalStorage survives awaits with no
 * framework glue.
 *
 * Module-level rather than a provider so the logger, which Nest constructs
 * before DI, can read it. Returns `undefined` outside a scope (startup,
 * schedulers): inventing a traceId there would imply a correlation that does
 * not exist.
 */
const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  get traceId(): string | undefined {
    return storage.getStore()?.traceId;
  },

  /** Middleware runs before guards, so the user id is attached later. */
  setUserId(userId: string): void {
    const store = storage.getStore();
    if (store) store.userId = userId;
  },
};
