// 主管（Supervisor）节点：读取团队共享状态，组装 prompt，调用模型产出委派/结束决策。
// 解析失败时自动重试一次（更严格的格式提醒），仍失败则降级结束（AC-15）。

import { HumanMessage } from 'langchain';
import { agentPool } from '../pool/AgentPool.js';
import { readConfigByAgentName } from '../readConfig.js';
import type { TeamConfig, SupervisorDecision } from './types.js';
import type { TeamState } from './team-state-store.js';
import { parseSupervisorDecision } from './delegation-parser.js';

/** 组装主管决策 prompt：成员能力 + 任务 + 进展 + 产物 + 委派历史 + 输出格式约束 */
export function buildSupervisorPrompt(team: TeamConfig, state: TeamState): string {
  const workerLines = team.workers
    .map((name) => {
      let caps = '';
      try {
        const cfg = readConfigByAgentName(name) as any;
        const capList: string[] = cfg?.capabilities ?? [];
        caps = capList.length > 0 ? capList.join('、') : cfg?.role ?? '';
      } catch {
        /* 忽略 */
      }
      return `- ${name}${caps ? `（能力：${caps}）` : ''}`;
    })
    .join('\n');

  const progress = state.messages
    .slice(-14)
    .map((m) => `[${m.agent ?? m.role}] ${m.content}`)
    .join('\n');

  const artifacts = state.artifacts.map((a) => `- ${a.path}（by ${a.worker}）`).join('\n');

  const history = state.delegationHistory
    .map(
      (d) =>
        `- ${d.worker}: ${d.subtask} → ${d.status}${d.summary ? `（${d.summary.slice(0, 80)}）` : ''}${d.error ? `【错误：${d.error}】` : ''}`,
    )
    .join('\n');

  return `你是团队「${team.name}」的主管（Supervisor），负责把任务拆解并委派给合适的 Worker，或在任务完成时宣布结束。

【可用团队成员】
${workerLines || '（无可用 Worker）'}

【当前总任务】
${state.task}

【已有进展（消息摘要）】
${progress || '（暂无）'}

【已产出文件】
${artifacts || '（暂无）'}

【委派历史】
${history || '（暂无）'}

请基于以上信息做决策，**只输出一个 JSON 对象**，不要输出任何多余文字、不要使用 markdown 代码块：
- 需要继续委派时：{"delegate":"<worker名>","subtask":"<给该 worker 的子任务描述>"}
  若要并行委派多个 worker，delegate 用数组：{"delegate":["A","B"],"subtask":"并行子任务描述"}
- 任务已完成或无法继续时：{"finish":true,"summary":"<最终汇总>"}

只能委派给上方列出的团队成员。若某 worker 之前失败，可换其他成员重试或直接结束并汇总已完成部分。`;
}

function resultToText(result: any): string {
  const c = result?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c.map((x: any) => (typeof x === 'string' ? x : x?.text ?? '')).join('');
  }
  return '';
}

/** 主管决策：调用模型 → 解析 → 失败重试一次 → 降级结束 */
export async function supervisorDecide(
  team: TeamConfig,
  state: TeamState,
): Promise<SupervisorDecision> {
  const model = await agentPool.getModel(team.supervisor);
  const prompt = buildSupervisorPrompt(team, state);

  const invoke = async (extra = ''): Promise<SupervisorDecision> => {
    const result = await model.invoke([new HumanMessage({ content: prompt + extra })]);
    const raw = resultToText(result);
    return parseSupervisorDecision(raw);
  };

  let decision = await invoke();
  if (!decision.parsed) {
    // 重试一次，附加强格式提醒
    decision = await invoke(
      '\n\n重要提醒：上一次输出未能解析为合法 JSON。请严格只输出一个 JSON 对象，不要任何其他文字或 markdown 标记。',
    );
  }
  if (!decision.parsed) {
    // 仍失败 → 降级结束，不阻塞团队
    return {
      finish: true,
      summary: '主管决策输出无法解析，团队已结束。请检查模型配置后重试。',
      parsed: false,
      raw: decision.raw,
    };
  }
  return decision;
}
