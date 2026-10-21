import { DynamicModule, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateApiEnv, validateWorkerEnv } from './env.validation';

export type ProcessRole = 'api' | 'worker';

/**
 * Global, validated configuration, imported once by each root module.
 * Each process validates only what it reads: the worker schema has no
 * database or JWT variables.
 */
@Module({})
export class AppConfigModule {
  static forRoot(role: ProcessRole): DynamicModule {
    return {
      module: AppConfigModule,
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          cache: true,
          validate: role === 'api' ? validateApiEnv : validateWorkerEnv,
        }),
      ],
    };
  }
}
