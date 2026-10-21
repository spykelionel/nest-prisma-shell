import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { requestContext } from './request-context';

export const TRACE_HEADER = 'x-request-id';

/** Accept a caller-supplied id only if it is a sane token (no log injection). */
const VALID_TRACE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * Opens the correlation scope for every request. An inbound `x-request-id`
 * (from the proxy or client) is honoured, otherwise one is generated; it is
 * echoed on the response so a failed call can be matched to its logs.
 *
 * Registered with `app.use` before anything else that logs.
 */
export function requestContextMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const inbound = req.headers[TRACE_HEADER];
  const candidate = (Array.isArray(inbound) ? inbound[0] : inbound)?.trim();
  const traceId =
    candidate && VALID_TRACE_ID.test(candidate) ? candidate : randomUUID();

  res.setHeader(TRACE_HEADER, traceId);
  requestContext.run({ traceId }, () => next());
}
