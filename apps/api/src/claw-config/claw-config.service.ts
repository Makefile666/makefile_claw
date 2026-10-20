import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  BUILTIN_TOOLS,
  DEFAULT_CONFIG,
  type AgentConfig,
  type ClawConfig,
  type ToolConfig,
} from './claw-config.types.js';

/**
 * 兼容旧版 Agent 字段：
 * - modelId  -> model
 * - tools    从 { id, config }[] 归一化为 string[]（只取 id）
 * - active   缺失时默认 1（启用）
 */
const migrateAgent = (raw: Record<string, unknown>): AgentConfig => {
  const tools = Array.isArray(raw.tools)
    ? raw.tools
        .map((t) => (typeof t === 'string' ? t : (t as { id?: string })?.id))
        .filter((id): id is string => !!id)
    : [];
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    model: String(raw.model ?? raw.modelId ?? ''),
    systemPrompt: String(raw.systemPrompt ?? ''),
    tools,
    active: typeof raw.active === 'number' ? raw.active : 1,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
};

/**
 * 共享配置服务：负责 ~/.makefile_claw/makefile_claw.json 的读写。
 * 所有业务模块（agents / models / tools）都通过本服务操作配置文件，
 * 各业务模块的 Service 只关注对应子树的 CRUD。
 */
@Injectable()
export class ClawConfigService implements OnModuleInit {
  private readonly logger = new Logger(ClawConfigService.name);
  private readonly configDir: string;
  private readonly configFile: string;

  constructor() {
    this.configDir = join(homedir(), '.makefile_claw');
    this.configFile = join(this.configDir, 'makefile_claw.json');
  }

  onModuleInit() {
    this.ensureConfigFile();
    this.logger.log(`配置文件路径: ${this.configFile}`);
  }

  /** 确保配置目录和文件存在，不存在则用默认值创建 */
  private ensureConfigFile(): void {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
      this.logger.log(`已创建配置目录: ${this.configDir}`);
    }
    if (!existsSync(this.configFile)) {
      this.atomicWrite(JSON.stringify(DEFAULT_CONFIG, null, 2));
      this.logger.log(`已创建默认配置文件: ${this.configFile}`);
    }
  }

  /** 写入配置文件：先写临时文件再原子 rename，带重试以应对 Windows 文件锁定（Defender） */
  private atomicWrite(content: string, retries = 20) {
    const tmpFile = `${this.configFile}.tmp`;
    for (let i = 0; i < retries; i++) {
      try {
        writeFileSync(tmpFile, content, 'utf-8');
        renameSync(tmpFile, this.configFile);
        return;
      } catch (e) {
        if (i === retries - 1) break;
        this.logger.warn(
          `写入配置文件失败，重试 ${i + 1}/${retries}: ${(e as Error).message}`,
        );
        const waitMs = 200 * (i + 1);
        const end = Date.now() + waitMs;
        while (Date.now() < end) {
          // busy wait
        }
      }
    }
    // 兜底：Windows Defender 可能拦截 node.exe 直写，改用 PowerShell 写入
    if (process.platform === 'win32') {
      try {
        const b64 = Buffer.from(content, 'utf-8').toString('base64');
        execFileSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `[System.IO.File]::WriteAllBytes('${this.configFile}',[System.Convert]::FromBase64String('${b64}'))`,
          ],
          { stdio: 'pipe' },
        );
        this.logger.log('已通过 PowerShell 兜底写入配置文件');
        return;
      } catch (e) {
        this.logger.warn(`PowerShell 兜底写入失败: ${(e as Error).message}`);
      }
    }
    // 最终兜底：直接写入（会抛出原始错误）
    writeFileSync(this.configFile, content, 'utf-8');
  }

  /** 读取完整配置，合并内置工具 */
  readConfig(): ClawConfig {
    let config: ClawConfig;
    try {
      const raw = readFileSync(this.configFile, 'utf-8');
      config = JSON.parse(raw) as ClawConfig;
    } catch (e) {
      this.logger.warn(`读取配置文件失败，使用默认值: ${(e as Error).message}`);
      config = { ...DEFAULT_CONFIG };
    }
    // 合并内置工具：已存在的保留用户设置，新增的补默认值
    const existingToolIds = new Set(config.tools?.map((t) => t.id) ?? []);
    const mergedTools: ToolConfig[] = [
      ...(config.tools ?? []),
      ...BUILTIN_TOOLS.filter((t) => !existingToolIds.has(t.id)),
    ];
    return {
      agents: (config.agents ?? []).map((a) => migrateAgent(a as unknown as Record<string, unknown>)),
      models: config.models ?? [],
      tools: mergedTools,
    };
  }

  /** 保存完整配置 */
  saveConfig(config: ClawConfig): ClawConfig {
    const existingToolIds = new Set(config.tools?.map((t) => t.id) ?? []);
    const mergedTools: ToolConfig[] = [
      ...(config.tools ?? []),
      ...BUILTIN_TOOLS.filter((t) => !existingToolIds.has(t.id)),
    ];
    const toSave: ClawConfig = {
      agents: config.agents ?? [],
      models: config.models ?? [],
      tools: mergedTools,
    };
    this.atomicWrite(JSON.stringify(toSave, null, 2));
    this.logger.log('配置已保存');
    return toSave;
  }

  getConfigPath(): string {
    return this.configFile;
  }
}
