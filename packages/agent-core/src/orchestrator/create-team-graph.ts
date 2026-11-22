// 编排引擎入口：createTeamGraph(team, teamThreadId) 返回可流式执行的团队图。
// 实现为「主管动态委派」循环（等价于 StateGraph: supervisor --conditional--> worker --> supervisor），
// 选择显式循环以便对每个事件精确打上 agent/stage 并实时 yield 给 SSE（AC-2 / AC-3 / AC-7）。

import { readConfigByAgentName } from '../readConfig.js';
import { TeamStateStore } from './team-state-store.js';
import type { TeamState } from './team-state-store.js';
import { supervisorDecide } from './supervisor.js';
import { runWorker } from './worker-runner.js';
import { ConcurrencyController } from './concurrency.js';
import { AsyncQueue } from './events.js';
import type { TeamConfig, TeamStreamEvent, RunTeamOptions, SupervisorDecision } from './types.js';

const now = () => new Date().toISOString();

/** 校验团队配置引用的 Agent 是否都存在 */
function validateTeam(team: TeamConfig): string | null {
  if (!team?.name) return '团队缺少 name';
  if (!team.supervisor) return '团队缺少 supervisor';
  if (!Array.isArray(team.workers) || team.workers.length === 0) return '团队 workers 不能为空';
  try {
    if (!readConfigByAgentName(team.supervisor)) return `主管 Agent「${team.supervisor}」不存在`;
  } catch {
    return `主管 Agent「${team.supervisor}」不存在`;
  }
  for (const w of team.workers) {
    try {
      if (!readConfigByAgentName(w)) return `Worker Agent「${w}」不存在`;
    } catch {
      return `Worker Agent「${w}」不存在`;
    }
  }
  return null;
}

/** 生成团队最终汇总（降级或正常结束时） */
function buildFinalSummary(state: TeamState, extra = ''): string {
  const done = state.delegationHistory.filter((d) => d.status === 'done');
  const failed = state.delegationHistory.filter((d) => d.status === 'failed');
  const lines: string[] = [];
  if (extra) lines.push(extra);
  lines.push(`【团队执行汇总】共委派 ${state.delegationHistory.length} 次，完成 ${done.length}，失败 ${failed.length}。`);
  if (done.length > 0) {
    lines.push('完成情况：');
    for (const d of done) lines.push(`- ${d.worker}: ${d.subtask}${d.summary ? ` → ${d.summary.slice(0, 120)}` : ''}`);
  }
  if (failed.length > 0) {
    lines.push('失败情况：');
    for (const d of failed) lines.push(`- ${d.worker}: ${d.subtask}（${d.error ?? '未知错误'}）`);
  }
  if (state.artifacts.length > 0) {
    lines.push(`产出文件：${state.artifacts.map((a) => a.path).join('、')}`);
  }
  return lines.join('\n');
}

/** 执行团队任务，产出带 agent/stage 的流式事件 */
export async function* runTeamStream(
  team: TeamConfig,
  input: string,
  teamThreadId: string,
  opts: RunTeamOptions = {},
): AsyncGenerator<TeamStreamEvent> {
  const emit = (ev: Omit<TeamStreamEvent, 'ts'> & { ts?: string }): TeamStreamEvent => {
    const full: TeamStreamEvent = { ts: now(), ...ev };
    opts.onEvent?.(full);
    return full;
  };

  // 配置校验
  const validationError = validateTeam(team);
  if (validationError) {
    yield emit({ stage: 'error', agent: team?.supervisor ?? 'supervisor', error: validationError, content: `⚠️ 团队配置无效：${validationError}` });
    yield emit({ stage: 'final', agent: team?.supervisor ?? 'supervisor', content: `任务未启动：${validationError}` });
    return;
  }

  // 两层持久化：加载或初始化团队共享状态
  const store = new TeamStateStore();
  let state: TeamState = store.init(teamThreadId, team.name, input);
  // 每次调用都把本次 input 作为一条新用户消息追加，支持多轮续聊（chatId / thread-id 复用）。
  // 仅当最后一条已是相同内容的用户消息时跳过（重试幂等保护，避免前端重试造成重复）。
  const lastMsg = state.messages[state.messages.length - 1];
  const duplicateRetry = lastMsg?.role === 'user' && lastMsg?.content === input;
  if (!duplicateRetry) {
    state.messages.push({ role: 'user', content: input, ts: now() });
    state.status = 'running'; // 续聊新输入 → 重新进入运行态
    store.save(state);
  } else if (state.status !== 'running') {
    // 重试相同输入：不重复追加消息，但把状态切回 running（上一轮可能已 finished）
    state.status = 'running';
    store.save(state);
  }

  const concurrency = new ConcurrencyController(team.maxParallelWorkers ?? 3);
  const maxRounds = opts.maxRounds ?? 8;
  let invalidDelegationCount = 0;

  for (let round = 0; round < maxRounds; round++) {
    if (opts.signal?.aborted) {
      state.status = 'failed';
      state.finalSummary = '用户中止';
      store.save(state);
      yield emit({ stage: 'final', agent: team.supervisor, content: '任务已被中止。' });
      return;
    }

    // ---- 主管决策 ----
    let decision: SupervisorDecision;
    try {
      decision = await supervisorDecide(team, state);
    } catch (err) {
      const msg = (err as Error)?.message ?? String(err);
      state.status = 'failed';
      store.save(state);
      yield emit({ stage: 'error', agent: team.supervisor, error: msg, content: `⚠️ 主管决策失败：${msg}` });
      yield emit({ stage: 'final', agent: team.supervisor, content: buildFinalSummary(state, `主管异常：${msg}`) });
      return;
    }

    if (decision.finish) {
      state.finalSummary = decision.summary ?? '';
      state.status = 'finished';
      store.save(state);
      yield emit({
        stage: 'final',
        agent: team.supervisor,
        content: decision.summary?.trim()
          ? decision.summary
          : buildFinalSummary(state),
      });
      return;
    }

    // ---- 解析委派目标 ----
    const delegates = Array.isArray(decision.delegate)
      ? decision.delegate
      : decision.delegate
        ? [decision.delegate]
        : [];
    const subtask = decision.subtask?.trim() || state.task;
    const validWorkers = delegates.filter((w) => team.workers.includes(w));

    if (validWorkers.length === 0) {
      invalidDelegationCount++;
      const note = `主管委派了无效目标（${delegates.join(',') || '空'}），只能委派给：${team.workers.join('、')}。`;
      state.messages.push({ role: 'system', agent: 'orchestrator', content: note, ts: now() });
      yield emit({ stage: 'error', agent: team.supervisor, error: note, content: `⚠️ ${note}` });
      // 连续 2 次无效委派 → 降级结束，避免死循环
      if (invalidDelegationCount >= 2) {
        state.status = 'finished';
        state.finalSummary = '主管连续委派无效目标，团队结束。';
        store.save(state);
        yield emit({ stage: 'final', agent: team.supervisor, content: buildFinalSummary(state, '主管连续委派无效目标，已结束。') });
        return;
      }
      store.save(state);
      continue;
    }
    invalidDelegationCount = 0;

    yield emit({
      stage: 'delegate',
      agent: team.supervisor,
      worker: validWorkers.join(','),
      subtask,
      content: `📋 第 ${round + 1} 轮委派 → ${validWorkers.join('、')}：${subtask}`,
    });

    // ---- 并行执行 Worker（受 concurrency 信号量限流） ----
    const queue = new AsyncQueue<TeamStreamEvent | null>();
    let pending = validWorkers.length;
    for (const w of validWorkers) {
      runWorker(team, state, w, subtask, opts, concurrency, (ev) => queue.push(ev)).finally(() => {
        if (--pending === 0) queue.push(null);
      });
    }
    // 按到达顺序 yield 所有 worker 事件，直到本轮全部结束
    while (pending > 0) {
      const ev = await queue.next();
      if (ev === null) break;
      yield emit(ev);
    }
    queue.close();

    store.save(state);
  }

  // 达到最大轮次 → 降级结束
  state.status = 'finished';
  state.finalSummary = '达到最大委派轮次';
  store.save(state);
  yield emit({
    stage: 'final',
    agent: team.supervisor,
    content: buildFinalSummary(state, `已达最大委派轮次（${maxRounds}），团队结束。`),
  });
}

/** FR-3 入口：编译团队图，返回可流式执行的句柄 */
export function createTeamGraph(team: TeamConfig, teamThreadId: string) {
  return {
    teamThreadId,
    stream: (input: string, opts: RunTeamOptions = {}) =>
      runTeamStream(team, input, teamThreadId, opts),
  };
}
