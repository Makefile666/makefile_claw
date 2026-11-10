import { Module } from '@nestjs/common';
import { SkillsController } from './skills.controller.js';
import { SkillsService } from './skills.service.js';

@Module({
  controllers: [SkillsController],
  providers: [SkillsService],
  // 导出 SkillsService，供其他模块（如 ModelsModule）注入使用
  exports: [SkillsService],
})
export class SkillsModule {}
