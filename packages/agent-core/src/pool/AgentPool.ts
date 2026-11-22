// AgentPool：多智能体编排的资源池。
// - 模型实例按 agentName 缓存复用（ChatOpenAI 无会话状态，跨线程安全）。
// - MCP 子进程/连接走 McpRegistry 进程级单例（acquire 返回的 release 不杀进程）。
// - backend 与已编译 agent 按次创建（backend.rootDir 随 Worker 子工作区变化，不可跨 Worker 复用）。
// 解决约束 #1：多 Agent 不再每次请求重建 model + 拉起 MCP 子进程。

import { createMakefileClawAgent } from '../index.js';
import type { AgentCreateOptions } from '../index.js';
import { readConfigByAgentName, readConfigByModelName } from '../readConfig.js';
import { initStreamModel } from '../agents.js';
import { mcpRegistry } from './McpRegistry.js';
import type { ToolsEnable } from '../mcp/index.js';

interface CachedModel {
  model: any;
  /** 该缓存对应的 agentCfg.model 名称，配置变更时自动失效 */
  agentModelName: string;
  lastUsed: number;
}

export interface PooledAgent {
  agent: any;
  checkpointer: any;
  /** 释放本次占用：归还 MCP 引用、关闭本次 backend；model 与 MCP 子进程保留复用 */
  release: () => Promise<void>;
}

export class AgentPool {
  private models = new Map<string, CachedModel>();
  /** 进行中的模型创建 Promise：并发首次获取同一 agent 的模型时去重，避免重复 initStreamModel */
  private modelPromises = new Map<string, Promise<CachedModel>>();

  /** 获取（或创建并缓存）某 Agent 的模型实例，供主管等不需要完整 agent 的场景复用 */
  async getModel(agentName: string): Promise<any> {
    const agentCfg = readConfigByAgentName(agentName);
    if (!agentCfg) {
      throw new Error(`AgentPool: 智能体 "${agentName}" 不存在`);
    }
    let cached = this.models.get(agentName);
    // 配置变更（绑定的 model 名变了）→ 失效旧缓存，重新创建
    if (cached && cached.agentModelName !== agentCfg.model) {
      this.models.delete(agentName);
      cached = undefined;
    }
    if (!cached) {
      let p = this.modelPromises.get(agentName);
      if (!p) {
        const modelCfg = readConfigByModelName(agentCfg.model);
        if (!modelCfg) {
          throw new Error(`AgentPool: 智能体 "${agentName}" 绑定的模型 "${agentCfg.model}" 不存在`);
        }
        p = (async () => {
          const model = await initStreamModel(modelCfg);
          const entry = { model, agentModelName: agentCfg.model, lastUsed: Date.now() };
          this.models.set(agentName, entry);
          return entry;
        })();
        this.modelPromises.set(agentName, p);
        p.then(
          () => this.modelPromises.delete(agentName),
          () => this.modelPromises.delete(agentName),
        );
      }
      cached = await p;
    }
    cached.lastUsed = Date.now();
    return cached.model;
  }

  async acquire(
    agentName: string,
    threadId: string,
    toolsEnable: ToolsEnable,
    skillsContent: string,
    opts: AgentCreateOptions = {},
  ): Promise<PooledAgent> {
    // ---- 模型复用：按 agentName 缓存，绑定的 model 名称变更时重建 ----
    const cachedModel = await this.getModel(agentName);

    // ---- MCP 工具走共享注册表（同类子进程全进程唯一） ----
    const sharedMcp = await mcpRegistry.acquire(toolsEnable, opts.workspaceDir);
    try {
      const { agent, close, checkpointer } = await createMakefileClawAgent(
        agentName,
        threadId,
        toolsEnable,
        skillsContent,
        { ...opts, mcpTools: sharedMcp, model: cachedModel },
      );
      return { agent, checkpointer, release: close };
    } catch (err) {
      // 创建失败时归还 MCP 引用，避免泄漏
      await sharedMcp.close();
      throw err;
    }
  }

  /** LRU 淘汰长时间未使用的模型缓存（MCP 单例不在此处回收，由进程退出统一处理） */
  evictIdleModels(ttlMs = 30 * 60 * 1000): number {
    const now = Date.now();
    let evicted = 0;
    for (const [name, entry] of this.models) {
      if (now - entry.lastUsed > ttlMs) {
        this.models.delete(name);
        evicted++;
      }
    }
    return evicted;
  }

  /** 当前缓存的模型实例数（观测用） */
  get cachedModelCount(): number {
    return this.models.size;
  }

  /** 关闭池：释放所有 MCP 子进程与连接、清空模型缓存 */
  async closeAll(): Promise<void> {
    await mcpRegistry.closeAll();
    this.models.clear();
    this.modelPromises.clear();
  }
}

/** 进程级单例 */
export const agentPool = new AgentPool();
