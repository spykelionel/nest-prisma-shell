import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../http/error-codes';
import { ROLES_KEY } from './auth.decorators';
import { AuthenticatedRequest } from './auth.types';

/** Global guard, runs after JwtAuthGuard. No `@Roles()` means any authenticated user. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (user && required.some((role) => user.roles.includes(role))) return true;

    throw new ForbiddenException({
      code: ErrorCode.FORBIDDEN,
      message: 'Insufficient role',
    });
  }
}
