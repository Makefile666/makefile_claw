import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type { McpServerConfig } from '../claw-config/claw-config.types.js';
import type { CreateMcpServerDto, UpdateMcpServerDto } from './mcp.types.js';

@Injectable()
export class McpService {
  constructor(private readonly clawConfigService: ClawConfigService) {}

  /** 列表（默认返回全部） */
  findAll(): McpServerConfig[] {
    return this.clawConfigService.readConfig().mcpServers;
  }

  /** 单个（按 name 查找） */
  findOne(name: string): McpServerConfig {
    const server = this.clawConfigService
      .readConfig()
      .mcpServers.find((m) => m.name === name);
    if (!server) {
      throw new NotFoundException(`MCP 服务器 ${name} 不存在`);
    }
    return server;
  }

  /** 创建（name 必须唯一） */
  create(dto: CreateMcpServerDto): McpServerConfig {
    const config = this.clawConfigService.readConfig();
    if (config.mcpServers.some((m) => m.name === dto.name)) {
      throw new ConflictException(`MCP 服务器 ${dto.name} 已存在`);
    }
    const now = new Date().toISOString();
    const newServer: McpServerConfig = {
      active: 0,
      headers: {},
      ...dto,
      createdAt: now,
      updatedAt: now,
    };
    config.mcpServers.push(newServer);
    this.clawConfigService.saveConfig(config);
    return newServer;
  }

  /** 更新（按 name） */
  update(name: string, dto: UpdateMcpServerDto): McpServerConfig {
    const config = this.clawConfigService.readConfig();
    const idx = config.mcpServers.findIndex((m) => m.name === name);
    if (idx === -1) {
      throw new NotFoundException(`MCP 服务器 ${name} 不存在`);
    }
    // 若修改 name，需校验新 name 不与其他服务器冲突
    if (dto.name && dto.name !== name) {
      if (config.mcpServers.some((m) => m.name === dto.name)) {
        throw new ConflictException(`MCP 服务器 ${dto.name} 已存在`);
      }
    }
    const updated: McpServerConfig = {
      ...config.mcpServers[idx],
      ...dto,
      updatedAt: new Date().toISOString(),
    };
    config.mcpServers[idx] = updated;
    this.clawConfigService.saveConfig(config);
    return updated;
  }

  /** 删除（按 name） */
  remove(name: string): void {
    const config = this.clawConfigService.readConfig();
    const exists = config.mcpServers.some((m) => m.name === name);
    if (!exists) {
      throw new NotFoundException(`MCP 服务器 ${name} 不存在`);
    }
    config.mcpServers = config.mcpServers.filter((m) => m.name !== name);
    this.clawConfigService.saveConfig(config);
  }
}
