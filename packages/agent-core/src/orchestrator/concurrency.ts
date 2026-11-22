// 并发控制：全局 Worker 并行上限 + 单 Agent 并发上限（Task 8 / AC-8）。
// 用信号量把同时 execute 的 Worker 数限制在配置内，避免打爆模型 API 与本机进程。

import { readConfigByAgentName } from '../readConfig.js';

/** 通用计数信号量，支持排队 + 超时获取 */
export class Semaphore {
  private readonly max: number;
  private available: number;
  private waiters: Array<() => void> = [];

  constructor(max: number) {
    this.max = max > 0 ? Math.floor(max) : 1;
    this.available = this.max;
  }

  /** 当前持有许可数（正在执行的数量） */
  get active(): number {
    return this.max - this.available;
  }

  get capacity(): number {
    return this.max;
  }

  /**
   * 尝试获取一个许可，超时返回 false（不占槽）。
   * @param timeoutMs 排队等待上限，默认 5 分钟，避免死等
   */
  acquire(timeoutMs = 5 * 60 * 1000): Promise<boolean> {
    if (this.available > 0) {
      this.available--;
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const idx = this.waiters.indexOf(release);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(false);
      }, timeoutMs);
      const release = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(release);
    });
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      // 直接把许可交给下一个等待者，available 不变
      next();
    } else {
      this.available++;
    }
  }
}

/** 单 Agent 信号量注册表（进程级共享，跨团队运行约束同一 Agent 的并发） */
const agentSemaphores = new Map<string, Semaphore>();

function getAgentSemaphore(agentName: string): Semaphore {
  let sem = agentSemaphores.get(agentName);
  if (!sem) {
    let max = 2;
    try {
      const cfg = readConfigByAgentName(agentName) as any;
      if (cfg && typeof cfg.maxConcurrency === 'number' && cfg.maxConcurrency > 0) {
        max = cfg.maxConcurrency;
      }
    } catch {
      /* 配置读取失败用默认值 */
    }
    sem = new Semaphore(max);
    agentSemaphores.set(agentName, sem);
  }
  return sem;
}

/** 一次团队运行的并发控制器：持有本次运行的全局 Worker 信号量 + 复用进程级 Agent 信号量 */
export class ConcurrencyController {
  private global: Semaphore;
  /** 观测：当前同时 execute 的 Worker 数峰值 */
  peakConcurrency = 0;

  constructor(maxParallelWorkers = 3) {
    this.global = new Semaphore(maxParallelWorkers);
  }

  /** 同时获取「全局 Worker 槽」与「单 Agent 槽」，任一超时则返回 null（不执行该子任务） */
  async acquireSlots(agentName: string, timeoutMs = 5 * 60 * 1000): Promise<{ release: () => void } | null> {
    const agentSem = getAgentSemaphore(agentName);
    const gotGlobal = await this.global.acquire(timeoutMs);
    if (!gotGlobal) return null;
    const gotAgent = await agentSem.acquire(timeoutMs);
    if (!gotAgent) {
      this.global.release();
      return null;
    }
    const active = this.global.active;
    if (active > this.peakConcurrency) this.peakConcurrency = active;
    return {
      release: () => {
        agentSem.release();
        this.global.release();
      },
    };
  }

  get currentConcurrency(): number {
    return this.global.active;
  }
}
