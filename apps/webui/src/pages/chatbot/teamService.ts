// src/pages/chatbot/teamService.ts
import { OpenAIChatProvider, XRequest } from '@ant-design/x-sdk';

import type { TeamConfig } from '../agents/types';
import type {
  AttachmentData,
} from './service';
import type {
  TeamBubbleMessage,
  TeamChatMessage,
  TeamSegment,
  TeamStage,
} from './data';
import { CHAT_API_URL } from './service';

/**
 * 团队流式接口地址
 * 约定：POST /multi-agent/stream（注意没有 /api 前缀，与单 Agent 的 /models-streaming 同源）
 * 从 CHAT_API_URL 推导 origin：默认 http://localhost:3000 -> http://localhost:3000/multi-agent/stream
 * CORS 已在后端开启，开发环境直连。
 */
export const MULTI_AGENT_STREAM_URL = (() => {
  try {
    return new URL('/multi-agent/stream', CHAT_API_URL).toString();
  } catch {
    // CHAT_API_URL 为相对路径时（罕见），回退到同源相对路径
    return '/multi-agent/stream';
  }
})();

/** 运行时类型守卫：判断一条解析后的消息是否为团队气泡 */
export const isTeamBubbleMessage = (m: unknown): m is TeamBubbleMessage =>
  !!m &&
  typeof m === 'object' &&
  (m as { role?: unknown }).role === 'assistant' &&
  typeof (m as { agent?: unknown }).agent === 'string' &&
  typeof (m as { stage?: unknown }).stage === 'string' &&
  !Array.isArray((m as { team?: unknown }).team);

/** stage 中文标签映射 */
export const STAGE_LABELS: Record<string, string> = {
  delegate: '委派',
  execute: '执行',
  final: '最终',
  error: '错误',
  info: '信息',
};

/** stage 对应 Tag 颜色 */
export const STAGE_COLORS: Record<string, string> = {
  delegate: 'gold',
  execute: 'blue',
  final: 'green',
  error: 'red',
  info: 'default',
};

/** Agent 头像配色板（按名称哈希取色，保证同一 Agent 颜色稳定） */
const AGENT_COLOR_PALETTE = [
  '#1677ff',
  '#52c41a',
  '#faad14',
  '#f5222d',
  '#722ed1',
  '#13c2c2',
  '#eb2f96',
  '#fa8c16',
  '#2f54eb',
  '#a0d911',
];

/** 按 Agent 名称稳定哈希取色 */
export const hashAgentColor = (name: string): string => {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AGENT_COLOR_PALETTE[h % AGENT_COLOR_PALETTE.length];
};

/** 生成 segment 合并键：同一 agent+stage+worker+subtask 的连续分片累加到一起 */
const segmentKey = (seg: Pick<TeamSegment, 'agent' | 'stage' | 'worker' | 'subtask'>) =>
  `${seg.agent}::${seg.stage}::${seg.worker ?? ''}::${seg.subtask ?? ''}`;

/** 团队请求依赖：每次请求实时读取当前选中的团队 / 技能 / MCP / 附件 */
export interface TeamProviderDeps {
  getTeam: () => TeamConfig | null;
  getSkills: () => string[];
  getMcps: () => string[];
  getAttachments: () => AttachmentData[];
}

/**
 * 自定义 fetch 适配器
 * 与单 Agent 的 customFetch 同构，但 body 携带 team 而非 agent，
 * 且附件字段映射为后端团队接口约定的 { name, mime, base64 }。
 */
const teamFetch =
  (deps: TeamProviderDeps) =>
  async (
    baseURL: string | URL | Request,
    options: any,
  ): Promise<Response> => {
    const messages = options?.params?.messages ?? [];
    const lastUserMsg = [...messages]
      .reverse()
      .find((m: any) => m?.role === 'user');
    const input = lastUserMsg?.content ?? '';
    const chatId = options?.params?.chatId ?? '';
    const team = deps.getTeam();
    const skills = deps.getSkills();
    const mcpServers = deps.getMcps();
    // 团队接口附件约定：{ name, mime, base64 }；单 Agent 的 AttachmentData.data 是纯 base64
    const attachments = deps.getAttachments().map((a) => ({
      name: a.name,
      mime: a.type,
      base64: a.data,
    }));
    return fetch(baseURL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, chatId, team, skills, mcpServers, attachments }),
      signal: options?.signal,
    });
  };

/**
 * 团队聊天 Provider
 * 复用 OpenAIChatProvider 的 XRequest 流式 / 中止 / 消息管理基础设施，
 * 仅重写 transformMessage：把团队 SSE 分片按 agent+stage 累加成 segments，
 * 供 parser 拆分为多角色气泡。
 *
 * SSE 分片格式（与单 Agent 兼容，额外字段）：
 * data: {"choices":[{"delta":{"content":"..."}}],"sessionId":"...","agent":"<name>","stage":"...","worker"?,"subtask"?,"error"?"}\n\n
 * 以 data: [DONE]\n\n 结束。
 */
class TeamChatProvider extends OpenAIChatProvider<any, any, any> {
  transformMessage(info: any): any {
    const { originMessage, chunk, responseHeaders } = info ?? {};
    const base: TeamChatMessage =
      originMessage && Array.isArray(originMessage?.team?.segments)
        ? (originMessage as TeamChatMessage)
        : { role: 'assistant', content: '', team: { segments: [] } };

    let payload: any;
    try {
      const ct = responseHeaders?.get?.('content-type') ?? '';
      if (ct.includes('text/event-stream')) {
        const raw = chunk?.data;
        if (typeof raw !== 'string' || raw.trim() === '[DONE]') {
          return base;
        }
        payload = JSON.parse(raw);
      } else {
        payload = chunk;
      }
    } catch {
      // 解析失败（如畸形分片）直接返回已累积内容，不中断流
      return base;
    }
    if (!payload) return base;

    // 捕获 sessionId：下一轮请求作为 chatId 回传，实现多轮记忆
    if (payload.sessionId) {
      base.team.sessionId = payload.sessionId;
    }

    const content = payload?.choices?.[0]?.delta?.content ?? '';
    const agent = payload?.agent;
    const stage: TeamStage | undefined = payload?.stage;
    if (!agent || !stage) return base;

    const worker = payload?.worker;
    const subtask = payload?.subtask;
    const error = payload?.error;

    const segs = base.team.segments;
    const key = segmentKey({ agent, stage, worker, subtask });
    const last = segs[segs.length - 1];
    const appendToLast = !!last && segmentKey(last) === key;

    const target: TeamSegment = appendToLast
      ? last
      : { agent, stage, worker, subtask, content: '' };
    if (!appendToLast) segs.push(target);
    if (error) target.error = error;
    target.content += content ?? '';

    return base;
  }
}

/**
 * 创建团队聊天 Provider 实例工厂函数
 * @param onSessionId 回调：后端在首个 SSE 分片返回 sessionId 时触发，
 *                    前端捕获后存入会话映射，下一轮作为 chatId 回传
 * @param deps 每次请求实时读取的团队 / 技能 / MCP / 附件
 * 配合 useMemo 使用，避免组件重复实例化
 */
export const createTeamChatProvider = (
  onSessionId: ((id: string) => void) | undefined,
  deps: TeamProviderDeps,
) =>
  new TeamChatProvider({
    request: XRequest(MULTI_AGENT_STREAM_URL, {
      manual: true,
      fetch: teamFetch(deps),
      callbacks: {
        onUpdate: (data: any) => {
          if (!onSessionId) return;
          try {
            const parsed = JSON.parse(data?.data);
            if (parsed?.sessionId) onSessionId(parsed.sessionId);
          } catch {
            // 忽略 [DONE] 等非 JSON 分片
          }
        },
        onSuccess: () => {},
        onError: () => {},
      },
    }),
  });
