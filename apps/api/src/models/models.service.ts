import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type { ModelConfig } from '../claw-config/claw-config.types.js';
import type { CreateModelDto, UpdateModelDto } from './models.types.js';

@Injectable()
export class ModelsService {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 列表 */
  findAll(): ModelConfig[] {
    return this.clawConfigService.readConfig().models;
  }

  /** 单个（按 name 查找） */
  findOne(name: string): ModelConfig {
    const model = this.clawConfigService
      .readConfig()
      .models.find((m) => m.name === name);
    if (!model) {
      throw new NotFoundException(`Model ${name} 不存在`);
    }
    return model;
  }

  /** 创建（name 必须唯一，id 为 LLM 模型标识由用户填写） */
  create(dto: CreateModelDto): ModelConfig {
    const config = this.clawConfigService.readConfig();
    if (config.models.some((m) => m.name === dto.name)) {
      throw new ConflictException(`Model ${dto.name} 已存在`);
    }
    const newModel: ModelConfig = {
      active: 1,
      ...dto,
      createdAt: Date.now(),
    };
    config.models.push(newModel);
    this.clawConfigService.saveConfig(config);
    return newModel;
  }

  /** 更新（按 name） */
  update(name: string, dto: UpdateModelDto): ModelConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.models.findIndex((m) => m.name === name);
    if (idx === -1) {
      throw new NotFoundException(`Model ${name} 不存在`);
    }
    // 若修改 name，需校验新 name 不与其他模型冲突
    if (dto.name && dto.name !== name) {
      if (config.models.some((m) => m.name === dto.name)) {
        throw new ConflictException(`Model ${dto.name} 已存在`);
      }
    }
    const updated: ModelConfig = { ...config.models[idx], ...dto, createdAt: config.models[idx].createdAt };
    config.models[idx] = updated;
    this.clawConfigService.saveConfig(config);
    return updated;
  }

  /** 删除（按 name） */
  remove(name: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.models.some((m) => m.name === name);
    if (!exists) {
      throw new NotFoundException(`Model ${name} 不存在`);
    }
    config.models = config.models.filter((m) => m.name !== name);
    this.clawConfigService.saveConfig(config);
  }
}
