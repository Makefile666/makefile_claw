import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { SkillsService } from './skills.service.js';
import { success, type ApiResponse } from '../common/response.js';
import type {
  InstallSkillDto,
  SkillConfig,
  ToggleSkillActiveDto,
} from './skills.types.js';

/**
 * Skills 管理接口
 *
 * - GET    /api/skills            -> 列出所有已安装技能
 * - GET    /api/skills/:name      -> 获取单个技能详情（含正文内容）
 * - POST   /api/skills/install    -> 通过 skills.sh 安装命令安装技能
 * - PATCH  /api/skills/:name/active -> 切换技能启用状态
 * - DELETE /api/skills/:name      -> 删除技能
 */
@Controller('api/skills')
export class SkillsController {
  constructor(private readonly skillsService: SkillsService) {}

  /** 获取所有技能列表 */
  @Get()
  findAll(): ApiResponse<SkillConfig[]> {
    return success(this.skillsService.findAll());
  }

  /** 获取单个技能详情 */
  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<SkillConfig> {
    return success(this.skillsService.findOne(name));
  }

  /**
   * 安装技能
   * Body: { command: "npx skills add owner/repo" }
   */
  @Post('install')
  install(@Body() dto: InstallSkillDto): ApiResponse<SkillConfig> {
    return success(this.skillsService.install(dto.command), '安装成功');
  }

  /**
   * 切换技能启用状态
   * Body: { active: true | false }
   */
  @Patch(':name/active')
  toggleActive(
    @Param('name') name: string,
    @Body() dto: ToggleSkillActiveDto,
  ): ApiResponse<SkillConfig> {
    return success(
      this.skillsService.toggleActive(name, dto.active),
      dto.active ? '已启用' : '已停用',
    );
  }

  /** 删除技能 */
  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.skillsService.remove(name);
    return success(null, '删除成功');
  }
}
