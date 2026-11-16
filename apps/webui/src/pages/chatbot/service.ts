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

// ==========================================================
// 工作区文件浏览相关接口（供右侧 Folder 组件使用）
// ==========================================================

/** 工作区文件树节点（后端返回格式） */
export interface WorkspaceTreeNode {
  title: string;
  path: string;
  isLeaf: boolean;
  children?: WorkspaceTreeNode[];
}

/**
 * 获取工作区目录树
 * GET /models-streaming/workspace/tree
 *
 * 返回 ~/.makefile_claw/workspaces 下的递归文件树，供 Folder 组件渲染。
 */
export const fetchWorkspaceTree = async (): Promise<WorkspaceTreeNode[]> => {
  const res = await fetch(`${CHAT_API_URL}/workspace/tree`);
  const data = await res.json();
  return data.tree ?? [];
};

/**
 * 读取工作区内指定文件的内容
 * GET /models-streaming/workspace/file?path=xxx
 *
 * @param relPath 相对于工作区根的路径（如 "subdir/file.txt"）
 */
export const readWorkspaceFile = async (relPath: string): Promise<string> => {
  const url = `${CHAT_API_URL}/workspace/file?path=${encodeURIComponent(relPath)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error || `readWorkspaceFile failed: ${res.status}`);
  }
  const data = await res.json();
  return data.content ?? '';
};

/**
 * 自定义 fetch 适配器
 *
 * 适配目的：
 * Ant Design X 的 OpenAIChatProvider 默认 POST 提交 messages 数组；
 * 后端接口 POST /models-streaming 接收 JSON body（input、chatId、agent、skills、mcpServers、attachments）。
 * 这里拦截请求，取出最后一条用户消息和会话ID，连同 agent/skills/mcpServers/附件一起 POST 给后端。
 * - agent：后端按名称加载该 Agent 配置（模型、systemPrompt）
 * - skills：后端加载各技能正文，注入到 system prompt 末尾
 * - mcpServers：后端按名称加载 MCP 服务器配置，通过 Streamable HTTP 连接并加载远程工具
 * - attachments：图片转 base64 供多模态模型识别，文档由后端提取文本
 */
const customFetch =
  (
    getAgent: () => string,
    getSkills: () => string[],
    getMcps: () => string[] = () => [],
    getAttachments: () => AttachmentData[] = () => [],
  ) =>
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
    // 取出当前选中的 MCP 服务器名称数组
    const mcpServers = getMcps();
    // 取出当前附件列表（图片 base64 + 文档 base64）
    const attachments = getAttachments();
    // POST JSON body，避免 GET URL 长度限制
    return fetch(baseURL as string, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input, chatId, agent, skills, mcpServers, attachments }),
      signal: options?.signal,
    });
  };

/** 附件数据结构：文件名、MIME 类型、base64 编码内容 */
export interface AttachmentData {
  name: string;
  type: string;
  data: string;
}

/**
 * 创建聊天 Provider 实例工厂函数
 * @param onSessionId 回调：当后端在 SSE 分片中返回 sessionId（首个分片的id）时触发，
 *                    前端捕获后用于后续请求回传，实现多轮对话记忆
 * @param getAgent 回调：返回当前选中的 Agent 名称，每次请求实时获取
 * @param getSkills 回调：返回当前选中的技能名称数组，每次请求实时获取
 * @param getMcps 回调：返回当前选中的 MCP 服务器名称数组，每次请求实时获取
 * @param getAttachments 回调：返回当前附件数组（base64），每次请求实时获取
 * 配合 useMemo 使用，避免组件重复实例化
 * OpenAIChatProvider 内部自动完成 SSE 分片解析、消息拼接
 */
export const createChatProvider = (
  onSessionId?: (id: string) => void,
  getAgent: () => string = () => '',
  getSkills: () => string[] = () => [],
  getMcps: () => string[] = () => [],
  getAttachments: () => AttachmentData[] = () => [],
) =>
  new OpenAIChatProvider({
    request: XRequest(CHAT_API_URL, {
      manual: true,
      fetch: customFetch(getAgent, getSkills, getMcps, getAttachments), // ✅【只负责：改写请求】
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
