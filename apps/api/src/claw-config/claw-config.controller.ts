import { Body, Controller, Get, Put } from '@nestjs/common';
import { ClawConfigService } from './claw-config.service.js';
import { success, type ApiResponse } from '../common/response.js';
import type { ClawConfig } from './claw-config.types.js';

/**
 * 配置整体读写接口
 */
@Controller('api/claw')
export class ClawConfigController {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 获取完整配置（agents + models + tools） */
  @Get('config')
  getConfig(): ApiResponse<ClawConfig> {
    return success(this.clawConfigService.readConfig());
  }

  /**
   * 整体保存配置（覆盖写入 .makefile_claw/makefile_claw.json）
   * ⚠️ models 和 tools 字段受保护：始终以磁盘上的最新数据为准，
   *    不允许通过本接口覆盖，避免与各自独立接口并发读写时互相覆盖。
   *    models 的增删改请统一走 /api/models，tools 走 /api/tools。
   */
  @Put('config')
  saveConfig(@Body() config: ClawConfig): ApiResponse<ClawConfig> {
    const current = this.clawConfigService.readConfig();
    const toSave: ClawConfig = { ...config, models: current.models, tools: current.tools };
    this.clawConfigService.saveConfig(toSave);
    return success(this.clawConfigService.readConfig());
  }
}
