import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { AuthenticatedRequest, AuthUser } from './auth.types';

export const IS_PUBLIC_KEY = 'auth:isPublic';
export const ROLES_KEY = 'auth:roles';

/** Opts a route (or controller) out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires at least one of the given roles. Implies authentication. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** The authenticated caller. Only valid on non-public routes. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) {
      // A route used @CurrentUser() and @Public() together: a programming error.
      throw new Error('@CurrentUser() used on a route without authentication');
    }
    return user;
  },
);
