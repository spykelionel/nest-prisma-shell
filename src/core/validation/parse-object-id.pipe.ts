import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ErrorCode } from '../http/error-codes';

const OBJECT_ID = /^[a-f\d]{24}$/i;

export function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && OBJECT_ID.test(value);
}

/**
 * Rejects malformed ids with a 400 before they reach Prisma, which would
 * otherwise fail the query (P2023).
 *
 *   @Get(':id') findOne(@Param('id', ParseObjectIdPipe) id: string)
 */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<unknown, string> {
  transform(value: unknown): string {
    if (!isObjectId(value)) {
      throw new BadRequestException({
        code: ErrorCode.BAD_REQUEST,
        message: 'Invalid id',
      });
    }
    return value.toLowerCase();
  }
}
