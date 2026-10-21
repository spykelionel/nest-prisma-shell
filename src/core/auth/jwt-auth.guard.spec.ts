import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { requestContext } from '../context/request-context';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 's'.repeat(32);

function contextFor(headers: Record<string, string>, isPublic = false) {
  const request: { headers: Record<string, string>; user?: unknown } = {
    headers,
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(isPublic),
  } as unknown as Reflector;
  const context = {
    getType: () => 'http',
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { request, reflector, context };
}

describe('JwtAuthGuard', () => {
  const jwt = new JwtService({ secret: SECRET });

  it('lets @Public() routes through without a token', async () => {
    const { reflector, context } = contextFor({}, true);
    await expect(
      new JwtAuthGuard(reflector, jwt).canActivate(context),
    ).resolves.toBe(true);
  });

  it('rejects a missing token', async () => {
    const { reflector, context } = contextFor({});
    await expect(
      new JwtAuthGuard(reflector, jwt).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a token signed with another secret', async () => {
    const forged = new JwtService({ secret: 'x'.repeat(32) }).sign({
      sub: 'u1',
    });
    const { reflector, context } = contextFor({
      authorization: `Bearer ${forged}`,
    });
    await expect(
      new JwtAuthGuard(reflector, jwt).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the user and records it on the request context', async () => {
    const token = jwt.sign({
      sub: '507f1f77bcf86cd799439011',
      roles: ['admin', 7],
    });
    const { request, reflector, context } = contextFor({
      authorization: `Bearer ${token}`,
    });

    await requestContext.run({ traceId: 'trace-abcdefgh' }, async () => {
      await new JwtAuthGuard(reflector, jwt).canActivate(context);
      expect(requestContext.get()?.userId).toBe('507f1f77bcf86cd799439011');
    });
    expect(request.user).toEqual({
      id: '507f1f77bcf86cd799439011',
      roles: ['admin'],
    });
  });
});
