import { createTeamGraph, agentPool } from '@makefile-claw/agent-core';
import type { TeamConfig, TeamStreamEvent } from '@makefile-claw/agent-core';

/** stage → 人类可读前缀（与 API SSE 的 stage 对齐） */
const STAGE_LABEL: Record<string, string> = {
  delegate: '委派',
  execute: '执行',
  final: '完成',
  error: '错误',
  info: '信息',
};

export interface RunResult {
  /** 0 = 正常结束（即使流中出现 error 阶段事件也算完成）；2 = 执行异常 */
  exitCode: 0 | 2;
  /** final 阶段的汇总内容（用于定时任务日志） */
  finalSummary?: string;
}

/**
 * 调用 createTeamGraph 消费事件流，并按人类可读或 --json 逐行打印。
 * 结束前必定 await agentPool.closeAll()，避免 MCP 子进程导致进程不退出。
 */
export async function runTeamStream(
  team: TeamConfig,
  input: string,
  threadId: string,
  opts: { json: boolean },
): Promise<RunResult> {
  let finalSummary: string | undefined;
  let lastKey = '';

  const print = (ev: TeamStreamEvent) => {
    if (opts.json) {
      console.log(JSON.stringify(ev));
      return;
    }
    const label = STAGE_LABEL[ev.stage] ?? ev.stage;
    const key = `${ev.stage}:${ev.agent}`;
    const text = ev.content ?? ev.error ?? '';
    if (!text) return;
    if (key !== lastKey) {
      if (lastKey) process.stdout.write('\n');
      process.stdout.write(`[${label}/${ev.agent}] `);
      lastKey = key;
    }
    process.stdout.write(text);
  };

  try {
    const graph = createTeamGraph(team, threadId);
    const stream = graph.stream(input, { maxRounds: 8 });
    for await (const ev of stream) {
      if (ev.stage === 'final' && ev.content) finalSummary = ev.content;
      print(ev);
    }
    if (!opts.json) process.stdout.write('\n');
    return { exitCode: 0, finalSummary };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!opts.json) {
      process.stderr.write(`\n[错误] 团队执行异常：${msg}\n`);
    } else {
      console.log(
        JSON.stringify({
          stage: 'error',
          agent: 'cli',
          error: msg,
          ts: new Date().toISOString(),
        }),
      );
    }
    return { exitCode: 2, finalSummary };
  } finally {
    // 必须关闭进程池，否则 MCP 子进程会让 Node 进程不退出
    await agentPool.closeAll();
  }
}
