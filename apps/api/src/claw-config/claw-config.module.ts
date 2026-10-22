import { Global, Module } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service.js';
import { ClawConfigController } from './claw-config.controller.js';

@Global()
@Module({
  controllers: [ClawConfigController],
  providers: [ClawConfigService],
  exports: [ClawConfigService],
})
export class ClawConfigModule {}
