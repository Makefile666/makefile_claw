// MCP 共享注册表：进程级单例复用 file / shell / puppeteer / remote MCP 子进程与连接。
// 解决多 Agent 场景下「每个 Agent 拉起一套 MCP stdio 子进程」的资源浪费（约束 #1 / AC-4）。
// acquire 返回的 close 仅递减引用计数并清理 shell 残留终端，不杀子进程；
// 子进程在进程退出（beforeExit/SIGINT/SIGTERM）时由 closeAll 统一回收。

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ChildProcess } from 'node:child_process';
import type { LoadedMcpTools, ToolsEnable } from '../mcp/index.js';
import {
  loadMcpFileTools,
  loadMcpShellTools,
  loadMcpPuppeteerTools,
  loadRemoteMcpTools,
  resolveRemoteServers,
  killMcpTree,
} from '../mcp/index.js';
import { getWorkspaceRoot } from '../paths.js';

interface CachedEntry {
  tools: any[];
  client: Client;
  childProcess?: ChildProcess;
  /** shell 专用：清理残留终端但不杀进程（保持单例长连接） */
  cleanupTerminals?: () => Promise<void>;
  refCount: number;
}

export class McpRegistry {
  private file?: CachedEntry & { workspace: string };
  private shell?: CachedEntry;
  private puppeteer?: CachedEntry;
  /** 远程 MCP 按 url 缓存（HTTP 无本地子进程） */
  private remote = new Map<string, CachedEntry>();
  private shutdownRegistered = false;
  /**
   * 进行中的首次创建 Promise，用于并发去重。
   * 多个 worker 并发首次 acquire 时，若不缓存该 Promise，各方都会越过 `!this.file` 检查、
   * 各自拉起一套 MCP 子进程，后者覆盖前者造成孤儿进程泄漏（违背 AC-4 / NFR-1 的「各 ≤1」）。
   */
  private filePromise?: Promise<CachedEntry & { workspace: string }>;
  private shellPromise?: Promise<CachedEntry>;
  private puppeteerPromise?: Promise<CachedEntry>;
  private remotePromises = new Map<string, Promise<CachedEntry>>();

  private ensureShutdownHook() {
    if (this.shutdownRegistered) return;
    this.shutdownRegistered = true;
    const handler = () => {
      void this.closeAll();
    };
    process.once('beforeExit', handler);
    process.once('SIGINT', handler);
    process.once('SIGTERM', handler);
  }

  /**
   * 按 toolsEnable 获取共享 MCP 工具。同类 MCP 全进程只创建一次，后续 acquire 复用同一客户端。
   * @param workspace 文件 MCP 绑定的工作区根；首次创建时生效，缺省为默认工作区根
   */
  async acquire(toolsEnable: ToolsEnable, workspace?: string): Promise<LoadedMcpTools> {
    this.ensureShutdownHook();
    const tools: any[] = [];
    const decrements: Array<() => void> = [];

    if (toolsEnable.fileTools) {
      if (!this.file) {
        if (!this.filePromise) {
          const ws = workspace ?? getWorkspaceRoot();
          this.filePromise = (async () => {
            const { fileTools, client, childProcess } = await loadMcpFileTools(ws);
            const entry = { tools: fileTools, client, childProcess, refCount: 0, workspace: ws };
            this.file = entry;
            return entry;
          })();
          this.filePromise.then(
            () => {
              this.filePromise = undefined;
            },
            () => {
              this.filePromise = undefined;
            },
          );
        }
        await this.filePromise;
      }
      if (!this.file) throw new Error('McpRegistry: file MCP 初始化失败');
      tools.push(...this.file.tools);
      this.file.refCount++;
      const f = this.file;
      decrements.push(() => {
        f.refCount--;
      });
    }

    if (toolsEnable.shellTools) {
      if (!this.shell) {
        if (!this.shellPromise) {
          this.shellPromise = (async () => {
            const { shellTools, client, cleanupTerminals, childProcess } = await loadMcpShellTools();
            const entry = { tools: shellTools, client, cleanupTerminals, childProcess, refCount: 0 };
            this.shell = entry;
            return entry;
          })();
          this.shellPromise.then(
            () => {
              this.shellPromise = undefined;
            },
            () => {
              this.shellPromise = undefined;
            },
          );
        }
        await this.shellPromise;
      }
      if (!this.shell) throw new Error('McpRegistry: shell MCP 初始化失败');
      tools.push(...this.shell.tools);
      this.shell.refCount++;
      const s = this.shell;
      // release 时清理本次可能残留的终端，但保留连接供后续复用
      decrements.push(() => {
        s.refCount--;
        void s.cleanupTerminals?.().catch(() => undefined);
      });
    }

    if (toolsEnable.puppeteerTools) {
      if (!this.puppeteer) {
        if (!this.puppeteerPromise) {
          this.puppeteerPromise = (async () => {
            const { puppeteerTools, client, childProcess } = await loadMcpPuppeteerTools();
            const entry = { tools: puppeteerTools, client, childProcess, refCount: 0 };
            this.puppeteer = entry;
            return entry;
          })();
          this.puppeteerPromise.then(
            () => {
              this.puppeteerPromise = undefined;
            },
            () => {
              this.puppeteerPromise = undefined;
            },
          );
        }
        await this.puppeteerPromise;
      }
      if (!this.puppeteer) throw new Error('McpRegistry: puppeteer MCP 初始化失败');
      tools.push(...this.puppeteer.tools);
      this.puppeteer.refCount++;
      const p = this.puppeteer;
      decrements.push(() => {
        p.refCount--;
      });
    }

    // 远程 MCP：按 url 去重缓存（并发首次获取同样去重，避免重复建连）
    for (const server of resolveRemoteServers(toolsEnable)) {
      const key = server.url;
      let entry = this.remote.get(key);
      if (!entry) {
        let p = this.remotePromises.get(key);
        if (!p) {
          p = (async () => {
            const { remoteTools, client } = await loadRemoteMcpTools(server);
            const e = { tools: remoteTools, client, refCount: 0 };
            this.remote.set(key, e);
            return e;
          })();
          this.remotePromises.set(key, p);
          p.then(
            () => this.remotePromises.delete(key),
            () => this.remotePromises.delete(key),
          );
        }
        entry = await p;
      }
      tools.push(...entry.tools);
      entry.refCount++;
      const e = entry;
      decrements.push(() => {
        e.refCount--;
      });
    }

    return {
      tools,
      close: async () => {
        for (const dec of decrements) dec();
        // 不关闭子进程：保持单例复用，仅在进程退出时 closeAll
      },
    };
  }

  /** 当前未释放的租约总数（所有类别 refCount 之和，用于观测/测试） */
  activeRefCount(): number {
    let n = 0;
    if (this.file) n += this.file.refCount;
    if (this.shell) n += this.shell.refCount;
    if (this.puppeteer) n += this.puppeteer.refCount;
    for (const e of this.remote.values()) n += e.refCount;
    return n;
  }

  /** 已创建的 MCP 单例数量（file/shell/puppeteer + remote） */
  instanceCount(): number {
    return (this.file ? 1 : 0) + (this.shell ? 1 : 0) + (this.puppeteer ? 1 : 0) + this.remote.size;
  }

  /** 进程退出时统一关闭所有 MCP 子进程与连接 */
  async closeAll(): Promise<void> {
    const kills: Promise<boolean>[] = [];
    const closes: Promise<void>[] = [];

    if (this.file) {
      await this.file.cleanupTerminals?.().catch(() => undefined);
      kills.push(killMcpTree(this.file.childProcess));
      closes.push(this.file.client.close());
    }
    if (this.shell) {
      await this.shell.cleanupTerminals?.().catch(() => undefined);
      kills.push(killMcpTree(this.shell.childProcess));
      closes.push(this.shell.client.close());
    }
    if (this.puppeteer) {
      kills.push(killMcpTree(this.puppeteer.childProcess));
      closes.push(this.puppeteer.client.close());
    }
    for (const e of this.remote.values()) closes.push(e.client.close());

    await Promise.allSettled(kills);
    await Promise.allSettled(closes);

    this.file = undefined;
    this.filePromise = undefined;
    this.shell = undefined;
    this.shellPromise = undefined;
    this.puppeteer = undefined;
    this.puppeteerPromise = undefined;
    this.remote.clear();
    this.remotePromises.clear();
  }
}

/** 进程级单例 */
export const mcpRegistry = new McpRegistry();
