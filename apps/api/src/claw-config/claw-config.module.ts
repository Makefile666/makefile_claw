import { Global, Module } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service.js';

@Global()
@Module({
  providers: [ClawConfigService],
  exports: [ClawConfigService],
})
export class ClawConfigModule {}
