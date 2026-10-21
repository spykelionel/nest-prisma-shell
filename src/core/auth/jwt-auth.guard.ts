import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { requestContext } from '../context/request-context';
import { ErrorCode } from '../http/error-codes';
import { IS_PUBLIC_KEY } from './auth.decorators';
import { AccessTokenPayload, AuthUser } from './auth.types';

function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

function unauthenticated(message: string): UnauthorizedException {
  return new UnauthorizedException({
    code: ErrorCode.UNAUTHENTICATED,
    message,
  });
}

/**
 * Global guard: every route requires a valid access token unless marked
 * `@Public()`. Secure by default — a new controller cannot ship open by
 * forgetting a decorator.
 *
 * Verification options (secret, issuer, audience) come from JwtModule's
 * registration in CoreAuthModule.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>();
    const token = bearerToken(request);
    if (!token) throw unauthenticated('Missing bearer token');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw unauthenticated('Invalid or expired token');
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw unauthenticated('Token has no subject');
    }

    request.user = {
      id: payload.sub,
      roles: Array.isArray(payload.roles)
        ? payload.roles.filter((r): r is string => typeof r === 'string')
        : [],
    };
    requestContext.setUserId(request.user.id);
    return true;
  }
}
