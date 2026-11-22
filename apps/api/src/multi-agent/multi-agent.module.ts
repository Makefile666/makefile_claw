import { Module } from "@nestjs/common";
import { MultiAgentController } from "./multi-agent.controller.js";
import { SkillsModule } from "../skills/skills.module.js";
import { ClawConfigModule } from "../claw-config/claw-config.module.js";

@Module({
  imports: [SkillsModule, ClawConfigModule],
  controllers: [MultiAgentController],
})
export class MultiAgentModule {}
