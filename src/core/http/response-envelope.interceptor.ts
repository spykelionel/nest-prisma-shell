import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Response } from 'express';
import { Observable, map } from 'rxjs';
import { ApiSuccess } from './api-response';

/**
 * Wraps handler results in the success envelope. Errors never pass through
 * here: HttpExceptionFilter answers them, so both shapes live in one place
 * each.
 *
 * Handlers that write the response themselves (`@Res()`) are unaffected —
 * Nest ignores the interceptor's value for them.
 */
@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiSuccess<T | null>
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccess<T | null>> {
    if (context.getType() !== 'http') {
      return next.handle() as unknown as Observable<ApiSuccess<T | null>>;
    }
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((data) => ({
        statusCode: response.statusCode,
        success: true as const,
        message: 'OK',
        data: data === undefined ? null : data,
      })),
    );
  }
}
