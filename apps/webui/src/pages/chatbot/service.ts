// src/pages/chatbot/service.ts
import { OpenAIChatProvider, XRequest } from '@ant-design/x-sdk';

/**
 * 后端大模型流式接口地址
 * 接口约定：GET /models-streaming?input=xxx，返回 OpenAI 兼容格式 SSE 流
 */
export const CHAT_API_URL =
  process.env.CHAT_API_URL ?? 'http://localhost:3000/models-streaming';

/** 历史会话条目 */
export interface SessionItem {
  threadId: string;
  title: string;
  manuallyRenamed: boolean;
  updatedAt: string;
}

/** 历史消息条目 */
export interface HistoryMessage {
  role: 'user' | 'assistant' | 'system' | string;
  content: string;
}

/**
 * 获取历史会话列表
 * GET /models-streaming/sessions
 */
export const fetchSessions = async (): Promise<SessionItem[]> => {
  const res = await fetch(`${CHAT_API_URL}/sessions`);
  const data = await res.json();
  return data.sessions ?? [];
};

/**
 * 获取指定会话的全部历史消息
 * GET /models-streaming/sessions/:threadId/messages
 */
export const fetchSessionMessages = async (
  threadId: string,
): Promise<HistoryMessage[]> => {
  const res = await fetch(
    `${CHAT_API_URL}/sessions/${encodeURIComponent(threadId)}/messages`,
  );
  const data = await res.json();
  return data.messages ?? [];
};

/**
 * 删除指定会话（检查点文件 + 元数据文件）
 * DELETE /models-streaming/sessions/:threadId
 */
export const deleteSession = async (threadId: string): Promise<void> => {
  const res = await fetch(
    `${CHAT_API_URL}/sessions/${encodeURIComponent(threadId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok) throw new Error(`deleteSession failed: ${res.status}`);
};

/**
 * 自动生成会话标题（基于第一条用户提问）
 * POST /models-streaming/sessions/:threadId/title
 * Body: { content }
 *
 * 后端规则：已手动改名则不覆盖；文字极短返回"新对话"；否则调用模型提炼。
 */
export const generateTitle = async (
  threadId: string,
  content: string,
): Promise<string> => {
  const res = await fetch(
    `${CHAT_API_URL}/sessions/${encodeURIComponent(threadId)}/title`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    },
  );
  if (!res.ok) throw new Error(`generateTitle failed: ${res.status}`);
  const data = await res.json();
  return data.title ?? '新对话';
};

/**
 * 手动修改会话标题
 * PUT /models-streaming/sessions/:threadId/title
 * Body: { title }
 *
 * 手动改名后后端会标记 manuallyRenamed=true，后续自动生成不会再覆盖。
 */
export const renameSession = async (
  threadId: string,
  title: string,
): Promise<void> => {
  const res = await fetch(
    `${CHAT_API_URL}/sessions/${encodeURIComponent(threadId)}/title`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    },
  );
  if (!res.ok) throw new Error(`renameSession failed: ${res.status}`);
};

/**
 * 自定义 fetch 适配器
 * @param baseURL 请求基础地址
 * @param options XRequest 传入的参数，包含 messages、chatId、signal 等
 * @returns fetch Response 对象
 *
 * 适配目的：
 * Ant Design X 的 OpenAIChatProvider 默认习惯 POST 提交 messages 数组；
 * 而我们后端接口是 GET 请求，接收 input 和 chatId 查询参数。
 * 所以在这里拦截请求，取出最后一条用户消息和会话ID，拼到 url 的 query 参数里。
 * 同时把当前选中的 agent 和 skills 列表拼到 query 参数：
 * - agent：后端按名称加载该 Agent 配置（模型、systemPrompt）
 * - skills：后端加载各技能正文，注入到 system prompt 末尾
 */
const customFetch =
  (getAgent: () => string, getSkills: () => string[]) =>
  async (
    baseURL: string | URL | Request,
    options: any,
  ): Promise<Response> => {
    // 从参数里取出对话消息列表
    const messages = options?.params?.messages ?? [];
    // 倒序查找，拿到最新一条用户消息作为提问输入
    const lastUserMsg = [...messages]
      .reverse()
      .find((m: any) => m?.role === 'user');
    const input = lastUserMsg?.content ?? '';
    // 取出当前会话ID，用于后端续聊（多轮记忆）
    const chatId = options?.params?.chatId ?? '';
    // 取出当前选中的 Agent 名称（单选）
    const agent = getAgent();
    // 取出当前选中的技能名称列表，逗号分隔传给后端
    const skills = getSkills().join(',');
    // 拼接 GET 参数，对输入内容和会话ID做 URI 编码，避免特殊字符破坏url
    const url = `${baseURL}?input=${encodeURIComponent(
      input,
    )}&chatId=${encodeURIComponent(chatId)}&agent=${encodeURIComponent(
      agent,
    )}&skills=${encodeURIComponent(skills)}`;
    // 透传 signal，绑定 AbortController，支持中断请求（停止生成）
    return fetch(url, { method: 'GET', signal: options?.signal });
  };

/**
 * 创建聊天 Provider 实例工厂函数
 * @param onSessionId 回调：当后端在 SSE 分片中返回 sessionId（首个分片的id）时触发，
 *                    前端捕获后用于后续请求回传，实现多轮对话记忆
 * @param getAgent 回调：返回当前选中的 Agent 名称，每次请求实时获取
 * @param getSkills 回调：返回当前选中的技能名称数组，每次请求实时获取
 * 配合 useMemo 使用，避免组件重复实例化
 * OpenAIChatProvider 内部自动完成 SSE 分片解析、消息拼接
 */
export const createChatProvider = (
  onSessionId?: (id: string) => void,
  getAgent: () => string = () => '',
  getSkills: () => string[] = () => [],
) =>
  new OpenAIChatProvider({
    request: XRequest(CHAT_API_URL, {
      manual: true,
      fetch: customFetch(getAgent, getSkills), // ✅【只负责：改写请求】
      // 通过 onUpdate 回调拦截原始 SSE 分片，提取后端返回的 sessionId
      callbacks: {
        onUpdate: (data: any) => {
          if (!onSessionId) return;
          try {
            // SSE 分片结构：{ data: '{"choices":[...],"sessionId":"xxx"}' }
            const parsed = JSON.parse(data?.data);
            if (parsed?.sessionId) {
              onSessionId(parsed.sessionId);
            }
          } catch {
            // 忽略解析失败（如 [DONE] 标记）
          }
        },
        onSuccess: () => {},
        onError: () => {},
      },
    }),
  });
