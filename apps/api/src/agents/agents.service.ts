import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type { AgentConfig } from '../claw-config/claw-config.types.js';
import type { CreateAgentDto, UpdateAgentDto } from './agents.types.js';

@Injectable()
export class AgentsService {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 列表 */
  findAll(): AgentConfig[] {
    return this.clawConfigService.readConfig().agents;
  }

  /** 单个（按 name 查找） */
  findOne(name: string): AgentConfig {
    const agent = this.clawConfigService
      .readConfig()
      .agents.find((a) => a.name === name);
    if (!agent) {
      throw new NotFoundException(`Agent ${name} 不存在`);
    }
    return agent;
  }

  /** 创建（name 必须唯一） */
  create(dto: CreateAgentDto): AgentConfig {
    const config = this.clawConfigService.readConfig();
    if (config.agents.some((a) => a.name === dto.name)) {
      throw new ConflictException(`Agent ${dto.name} 已存在`);
    }
    const newAgent: AgentConfig = {
      active: 1,
      ...dto,
    };
    config.agents.push(newAgent);
    this.clawConfigService.saveConfig(config);
    return newAgent;
  }

  /** 更新（按 name） */
  update(name: string, dto: UpdateAgentDto): AgentConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.agents.findIndex((a) => a.name === name);
    if (idx === -1) {
      throw new NotFoundException(`Agent ${name} 不存在`);
    }
    // 若修改 name，需校验新 name 不与其他智能体冲突
    if (dto.name && dto.name !== name) {
      if (config.agents.some((a) => a.name === dto.name)) {
        throw new ConflictException(`Agent ${dto.name} 已存在`);
      }
    }
    config.agents[idx] = { ...config.agents[idx], ...dto };
    this.clawConfigService.saveConfig(config);
    return config.agents[idx];
  }

  /** 删除（按 name） */
  remove(name: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.agents.some((a) => a.name === name);
    if (!exists) {
      throw new NotFoundException(`Agent ${name} 不存在`);
    }
    config.agents = config.agents.filter((a) => a.name !== name);
    this.clawConfigService.saveConfig(config);
  }
}
