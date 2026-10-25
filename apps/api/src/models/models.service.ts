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
      api_key_from_env: 0,
      ...dto,
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
    const updated: ModelConfig = { ...config.models[idx], ...dto };
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

  /**
   * 解析模型的真实 API Key
   * - api_key_from_env === 1：api_key 字段存储的是环境变量名，从 process.env 中读取真实密钥
   * - 否则：api_key 字段即为明文密钥
   * @param model 模型配置
   * @returns 真实可用的 API Key，若环境变量未设置则返回空字符串
   */
  resolveApiKey(model: ModelConfig): string {
    // 标记 api_key_from_env = 1 的时候
    if (model.api_key_from_env === 1) {
      // 把 model.api_key 当做【环境变量名】去 process.env 里面取值
      return process.env[model.api_key] ?? '';
    }
    // 否则直接返回配置里填的 api_key 明文
    return model.api_key;
  }
}
