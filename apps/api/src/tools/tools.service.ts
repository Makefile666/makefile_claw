import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type { ToolConfig } from '../claw-config/claw-config.types.js';
import type { CreateToolDto, UpdateToolDto } from './tools.types.js';

@Injectable()
export class ToolsService {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 列表 */
  findAll(): ToolConfig[] {
    return this.clawConfigService.readConfig().tools;
  }

  /** 单个（按 name 查找） */
  findOne(name: string): ToolConfig {
    const tool = this.clawConfigService
      .readConfig()
      .tools.find((t) => t.name === name);
    if (!tool) {
      throw new NotFoundException(`Tool ${name} 不存在`);
    }
    return tool;
  }

  /** 创建（name 必须唯一） */
  create(dto: CreateToolDto): ToolConfig {
    const config = this.clawConfigService.readConfig();
    if (config.tools.some((t) => t.name === dto.name)) {
      throw new ConflictException(`Tool ${dto.name} 已存在`);
    }
    const newTool: ToolConfig = {
      active: 0,
      builtin: 0,
      ...dto,
    };
    config.tools.push(newTool);
    this.clawConfigService.saveConfig(config);
    return newTool;
  }

  /** 更新（按 name） */
  update(name: string, dto: UpdateToolDto): ToolConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.tools.findIndex((t) => t.name === name);
    if (idx === -1) {
      throw new NotFoundException(`Tool ${name} 不存在`);
    }
    // 若修改 name，需校验新 name 不与其他工具冲突
    if (dto.name && dto.name !== name) {
      if (config.tools.some((t) => t.name === dto.name)) {
        throw new ConflictException(`Tool ${dto.name} 已存在`);
      }
    }
    const updated: ToolConfig = { ...config.tools[idx], ...dto };
    config.tools[idx] = updated;
    this.clawConfigService.saveConfig(config);
    return updated;
  }

  /** 删除（按 name） */
  remove(name: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.tools.some((t) => t.name === name);
    if (!exists) {
      throw new NotFoundException(`Tool ${name} 不存在`);
    }
    config.tools = config.tools.filter((t) => t.name !== name);
    this.clawConfigService.saveConfig(config);
  }
}
