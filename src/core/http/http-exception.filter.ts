import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { requestContext } from '../context/request-context';
import { ApiError } from './api-response';
import { defaultCodeForStatus, ErrorCode } from './error-codes';

interface Resolved {
  status: number;
  message: string;
  code: string;
  details?: string[];
}

/**
 * Prisma errors that are caller mistakes, not server faults. Anything else
 * from Prisma is a 500.
 * https://www.prisma.io/docs/orm/reference/error-reference
 */
function resolvePrismaError(
  error: Prisma.PrismaClientKnownRequestError,
): Resolved | undefined {
  switch (error.code) {
    case 'P2002':
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.CONFLICT,
        message: 'A record with the same unique value already exists',
      };
    case 'P2025':
      return {
        status: HttpStatus.NOT_FOUND,
        code: ErrorCode.NOT_FOUND,
        message: 'Record not found',
      };
    case 'P2023':
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'Malformed identifier',
      };
    default:
      return undefined;
  }
}

function resolveHttpException(error: HttpException): Resolved {
  const status = error.getStatus();
  const body = error.getResponse();

  if (typeof body === 'string') {
    return { status, message: body, code: defaultCodeForStatus(status) };
  }

  const { message, code } = body as { message?: unknown; code?: unknown };

  // ValidationPipe reports one string per failed constraint.
  if (Array.isArray(message)) {
    return {
      status,
      message: 'Validation failed',
      code: typeof code === 'string' ? code : ErrorCode.VALIDATION_FAILED,
      details: message.map(String),
    };
  }

  return {
    status,
    message: typeof message === 'string' ? message : error.message,
    code: typeof code === 'string' ? code : defaultCodeForStatus(status),
  };
}

/**
 * The single place HTTP errors are shaped and logged. Catches everything,
 * so unknown errors become a 500 envelope without leaking internals; the
 * real cause goes to the log with the traceId the client also receives.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;

    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const resolved = this.resolve(exception);
    const traceId = requestContext.traceId;

    const logEntry = {
      operation: 'http.error',
      method: request.method,
      path: request.originalUrl.split('?')[0],
      statusCode: resolved.status,
      code: resolved.code,
      status: 'error',
    };
    if (resolved.status === 503) {
      // Expected while a dependency is down (readiness probes hit this
      // every few seconds); the dependency's own logs carry the cause.
      this.logger.warn({ ...logEntry, message: resolved.message });
    } else if (resolved.status >= 500) {
      this.logger.error({ ...logEntry, err: exception });
    } else {
      this.logger.debug({ ...logEntry, message: resolved.message });
    }

    if (response.headersSent) return;

    const body: ApiError = {
      statusCode: resolved.status,
      success: false,
      message: resolved.message,
      code: resolved.code,
      data: null,
      ...(resolved.details ? { details: resolved.details } : {}),
      ...(traceId ? { traceId } : {}),
    };
    response.status(resolved.status).json(body);
  }

  private resolve(exception: unknown): Resolved {
    if (exception instanceof HttpException) {
      return resolveHttpException(exception);
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const known = resolvePrismaError(exception);
      if (known) return known;
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    };
  }
}
