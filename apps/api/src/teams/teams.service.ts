import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type { ClawConfig, TeamConfig } from '../claw-config/claw-config.types.js';
import type { CreateTeamDto, UpdateTeamDto } from './teams.types.js';

@Injectable()
export class TeamsService {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 列表 */
  findAll(): TeamConfig[] {
    return this.clawConfigService.readConfig().teams;
  }

  /** 单个（按 name 查找） */
  findOne(name: string): TeamConfig {
    const team = this.clawConfigService.readConfig().teams.find((t) => t.name === name);
    if (!team) {
      throw new NotFoundException(`Team ${name} 不存在`);
    }
    return team;
  }

  /** 创建（name 必须唯一；supervisor / workers 必须引用已存在的 Agent） */
  create(dto: CreateTeamDto): TeamConfig {
    const config = this.clawConfigService.readConfig();
    if (config.teams.some((t) => t.name === dto.name)) {
      throw new ConflictException(`Team ${dto.name} 已存在`);
    }
    this.assertAgentReferences(config, dto.supervisor, dto.workers ?? []);
    const now = new Date().toISOString();
    const newTeam: TeamConfig = {
      active: 1,
      ...dto,
      createdAt: now,
      updatedAt: now,
    };
    config.teams.push(newTeam);
    this.clawConfigService.saveConfig(config);
    return newTeam;
  }

  /** 更新（按 name） */
  update(name: string, dto: UpdateTeamDto): TeamConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.teams.findIndex((t) => t.name === name);
    if (idx === -1) {
      throw new NotFoundException(`Team ${name} 不存在`);
    }
    // 若修改 name，校验新 name 不冲突
    if (dto.name && dto.name !== name) {
      if (config.teams.some((t) => t.name === dto.name)) {
        throw new ConflictException(`Team ${dto.name} 已存在`);
      }
    }
    // 校验 supervisor / workers 引用（dto 中出现的字段才校验，缺省沿用原值）
    const nextSupervisor = dto.supervisor ?? config.teams[idx].supervisor;
    const nextWorkers = dto.workers ?? config.teams[idx].workers;
    this.assertAgentReferences(config, nextSupervisor, nextWorkers);

    config.teams[idx] = {
      ...config.teams[idx],
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    this.clawConfigService.saveConfig(config);
    return config.teams[idx];
  }

  /** 删除（按 name） */
  remove(name: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.teams.some((t) => t.name === name);
    if (!exists) {
      throw new NotFoundException(`Team ${name} 不存在`);
    }
    config.teams = config.teams.filter((t) => t.name !== name);
    this.clawConfigService.saveConfig(config);
  }

  /** 校验 supervisor 与所有 workers 都引用了已存在的 Agent，不允许悬空引用 */
  private assertAgentReferences(
    config: ClawConfig,
    supervisor: string,
    workers: string[],
  ): void {
    const agentNames = new Set(config.agents.map((a) => a.name));
    if (supervisor && !agentNames.has(supervisor)) {
      throw new BadRequestException(`主管 Agent 不存在: ${supervisor}`);
    }
    const missing = workers.filter((w) => !agentNames.has(w));
    if (missing.length > 0) {
      throw new BadRequestException(`Worker Agent 不存在: ${missing.join(', ')}`);
    }
  }
}
