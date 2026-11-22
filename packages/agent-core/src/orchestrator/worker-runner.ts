// Worker 节点执行器：从 AgentPool acquire 该 worker 的 agent（含子检查点 + 子工作区），
// 流式执行子任务，把内容分片以 stage=execute 事件推送，回写 TeamState，最后 release。
// 单个 worker 失败被捕获并记录归因，不向上抛出导致整个团队中断（AC-15）。

import { agentPool, type PooledAgent } from '../pool/AgentPool.js';
import {
  getWorkerCheckpointFile,
  getWorkerWorkspaceDir,
  getSharedWorkspaceDir,
  ensureDir,
} from '../paths.js';
import type { TeamConfig, TeamStreamEvent, RunTeamOptions } from './types.js';
import type { TeamState } from './team-state-store.js';
import { ConcurrencyController } from './concurrency.js';

const now = () => new Date().toISOString();

/** 从 LangChain 消息分片中抽取纯文本（兼容 string / 数组 / MCP 工具结果对象） */
export function extractChunkText(messageChunk: any): string {
  const raw = messageChunk?.content;
  if (raw == null) return '';
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) {
    return raw
      .map((c: any) => (typeof c === 'string' ? c : c?.text ?? ''))
      .join('');
  }
  if (typeof raw === 'object') {
    if (raw.structuredContent?.content) return String(raw.structuredContent.content);
    if (Array.isArray(raw.content)) {
      return raw.content.map((c: any) => (typeof c === 'string' ? c : c?.text ?? '')).join('');
    }
    if (typeof raw.content === 'string') return raw.content;
  }
  return '';
}

/**
 * 执行单个 worker 的子任务。
 * @param push 事件推送回调（由主编排器收集后 yield）
 * 注意：本函数只修改内存中的 state，不负责落盘；落盘由主编排器在每轮结束时统一 save。
 */
export async function runWorker(
  team: TeamConfig,
  state: TeamState,
  workerName: string,
  subtask: string,
  opts: RunTeamOptions,
  concurrency: ConcurrencyController,
  push: (ev: TeamStreamEvent) => void,
): Promise<void> {
  const teamThreadId = state.teamThreadId;
  // worker 子线程 id：同一 teamThreadId + workerName 跨轮次稳定，实现 worker 子检查点续聊
  const workerThreadId = `${teamThreadId}__${workerName}`;
  const checkpointFile = getWorkerCheckpointFile(teamThreadId, workerName);
  const workspaceDir = getWorkerWorkspaceDir(teamThreadId, workerName);
  const sharedDir = getSharedWorkspaceDir(teamThreadId);
  ensureDir(workspaceDir);
  ensureDir(sharedDir);

  const toolsEnable = opts.toolsEnable ?? {
    fileTools: true,
    shellTools: true,
    puppeteerTools: true,
    webTools: true,
    remoteServers: opts.mcpServers ?? [],
  };

  // 委派记录：先登记 running，结束时更新状态/摘要
  const recIdx = state.delegationHistory.length;
  state.delegationHistory.push({
    worker: workerName,
    subtask,
    status: 'running',
    startedAt: now(),
  });

  push({
    stage: 'info',
    agent: workerName,
    content: `▶ Worker「${workerName}」开始执行：${subtask}`,
    ts: now(),
  });

  // 并发限流：先获取全局 + 单 agent 槽，超时则跳过该子任务
  const slot = await concurrency.acquireSlots(workerName);
  if (!slot) {
    const msg = `Worker「${workerName}」等待并发槽超时（>${5 * 60}s），跳过该子任务`;
    state.delegationHistory[recIdx].status = 'failed';
    state.delegationHistory[recIdx].finishedAt = now();
    state.delegationHistory[recIdx].error = 'concurrency timeout';
    state.messages.push({ role: 'assistant', agent: workerName, content: `[跳过] ${msg}`, ts: now() });
    push({ stage: 'error', agent: workerName, error: msg, content: `⚠️ ${msg}`, ts: now() });
    return;
  }

  let pooled: PooledAgent | null = null;
  try {
    pooled = await agentPool.acquire(workerName, workerThreadId, toolsEnable, opts.skillsContent ?? '', {
      checkpointFile,
      workspaceDir,
      sharedDir,
    });

    const stream = await pooled.agent.stream(
      { messages: [{ role: 'user', content: subtask }] },
      {
        streamMode: 'messages',
        configurable: { thread_id: workerThreadId },
        recursionLimit: 100,
        signal: opts.signal,
      },
    );

    let summary = '';
    for await (const chunk of stream) {
      const [messageChunk] = chunk as [any, any];
      const text = extractChunkText(messageChunk);
      if (text) {
        summary += text;
        push({ stage: 'execute', agent: workerName, content: text, ts: now() });
      }
    }

    state.delegationHistory[recIdx].status = 'done';
    state.delegationHistory[recIdx].finishedAt = now();
    state.delegationHistory[recIdx].summary = summary.slice(0, 500);
    state.messages.push({
      role: 'assistant',
      agent: workerName,
      content: summary.slice(0, 1200),
      ts: now(),
    });
  } catch (err) {
    const errMsg = (err as Error)?.message ?? String(err);
    state.delegationHistory[recIdx].status = 'failed';
    state.delegationHistory[recIdx].finishedAt = now();
    state.delegationHistory[recIdx].error = errMsg;
    state.messages.push({
      role: 'assistant',
      agent: workerName,
      content: `[执行失败] ${errMsg}`,
      ts: now(),
    });
    push({
      stage: 'error',
      agent: workerName,
      error: errMsg,
      content: `⚠️ Worker「${workerName}」执行失败：${errMsg}`,
      ts: now(),
    });
  } finally {
    try {
      await pooled?.release();
    } catch {
      /* release 失败不阻塞主流程 */
    }
    slot.release();
  }
}
