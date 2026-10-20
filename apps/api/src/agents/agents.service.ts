import { Injectable, NotFoundException } from '@nestjs/common';
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

  /** 单个 */
  findOne(id: string): AgentConfig {
    const agent = this.clawConfigService
      .readConfig()
      .agents.find((a) => a.id === id);
    if (!agent) {
      throw new NotFoundException(`Agent ${id} 不存在`);
    }
    return agent;
  }

  /*
   * 创建Agent
   * @param dto 创建Agent请求数据传输对象
   * @returns 新建完成的Agent配置对象
  */
  create(dto: CreateAgentDto): AgentConfig {
    // 读取完整配置文件内容（内部自带旧数据自动迁移逻辑）
    const config = this.clawConfigService.readConfig();
    // 组装新Agent实体，默认active=1，用传入dto覆盖用户填写字段，补充id和创建时间
    const newAgent: AgentConfig = {
      // 默认启用状态
      active: 1,
      // 将前端传入的dto字段展开赋值，用户传入的值会覆盖上面默认值
      ...dto,
      // 生成唯一ID：时间戳 + 随机字符串，避免ID重复
      id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      // 记录创建时间，毫秒时间戳
      createdAt: Date.now(),
    };
    // 将新agent推入agents数组
    config.agents.push(newAgent);
    // 写入更新后的完整配置到json文件（自带原子写入、重试逻辑）
    this.clawConfigService.saveConfig(config);
    // 返回新建的agent信息给接口
    return newAgent;
  }

  /** 更新 */
  update(id: string, dto: UpdateAgentDto): AgentConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.agents.findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new NotFoundException(`Agent ${id} 不存在`);
    }
    config.agents[idx] = { ...config.agents[idx], ...dto, id, createdAt: config.agents[idx].createdAt };
    this.clawConfigService.saveConfig(config);
    return config.agents[idx];
  }

  /** 删除 */
  remove(id: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.agents.some((a) => a.id === id);
    if (!exists) {
      throw new NotFoundException(`Agent ${id} 不存在`);
    }
    config.agents = config.agents.filter((a) => a.id !== id);
    this.clawConfigService.saveConfig(config);
  }
}
