/**
 * The envelope every HTTP route answers with.
 *
 *   success: { statusCode, success: true,  message, data }
 *   error:   { statusCode, success: false, message, code, data: null, details?, traceId? }
 */
export interface ApiSuccess<T> {
  statusCode: number;
  success: true;
  message: string;
  data: T;
}

export interface ApiError {
  statusCode: number;
  success: false;
  message: string;
  code: string;
  data: null;
  /** Field-level problems, e.g. one entry per failed validation constraint. */
  details?: string[];
  /** Same value as the x-request-id response header. */
  traceId?: string;
}
