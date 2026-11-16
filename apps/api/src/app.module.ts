import { Module } from '@nestjs/common';
import { createObserveModule } from '@nestjs/observe';
import { AgentsModule } from './agents/agents.module.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ClawConfigModule } from './claw-config/claw-config.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { ModelsModule } from './models/models.module.js';
import { SkillsModule } from './skills/skills.module.js';
import { ToolsModule } from './tools/tools.module.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

@Module({
  imports: [
    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more — out of the box. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? '',
      appSecret: process.env.OBSERVE_APP_SECRET ?? '',
      runtimeMetrics: !Boolean(process.versions?.['webcontainer']),
      serviceId: 'nest-typescript-starter',
    }),
    ClawConfigModule,
    AgentsModule,
    ModelsModule,
    ToolsModule,
    SkillsModule,
    McpModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
