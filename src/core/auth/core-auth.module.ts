import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtModuleOptions } from '@nestjs/jwt';
import { EnvironmentVariables } from '../config/env.validation';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';

/**
 * Token verification and the global guards. Token *issuance* (login,
 * refresh) belongs in a feature auth module, which injects the exported
 * JwtService — signing then uses the same secret, issuer and audience.
 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<EnvironmentVariables, true>,
      ): JwtModuleOptions => {
        const issuer = config.get('JWT_ISSUER', { infer: true });
        const audience = config.get('JWT_AUDIENCE', { infer: true });
        return {
          secret: config.get('JWT_SECRET', { infer: true }),
          signOptions: {
            expiresIn: config.get('JWT_EXPIRES_IN_SECONDS', { infer: true }),
            algorithm: 'HS256',
            ...(issuer ? { issuer } : {}),
            ...(audience ? { audience } : {}),
          },
          verifyOptions: {
            algorithms: ['HS256'],
            ...(issuer ? { issuer } : {}),
            ...(audience ? { audience } : {}),
          },
        };
      },
    }),
  ],
  providers: [
    // Order matters: authentication before authorization.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [JwtModule],
})
export class CoreAuthModule {}
