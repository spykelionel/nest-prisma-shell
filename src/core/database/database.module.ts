import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** API process only. Global so feature repositories need no extra import. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
