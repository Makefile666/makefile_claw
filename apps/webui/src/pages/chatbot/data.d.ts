// src/pages/chatbot/data.d.ts

export interface ConversationItem {
  key: string;
  label: string;
  group?: string;
  isDraft?: boolean;
  /** 后端 threadId（历史会话的 key 与 threadId 相同；新对话首次响应后回填） */
  threadId?: string;
  /** 是否已手动改名：为 true 时不再自动生成标题覆盖 */
  manuallyRenamed?: boolean;
}

/** 思维链节点：由后端 <node title="...">...</node> 协议解析而来，供 ThoughtChain 渲染 */
export interface ThoughtNode {
  key: string;
  title: string;
  /** 节点描述行（官网 ThoughtChain 的 description）：标题下方的灰色摘要，折叠时也能看到关键信息 */
  description?: string;
  content: string;
  status: 'loading' | 'success' | 'error';
}

export type ParsedMessage =
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string;
      /** 思维链节点列表（<node> 协议解析结果；旧版无 node 的纯思考文本会归入「思考」节点） */
      thoughtItems?: ThoughtNode[];
    };

/** 团队流式 SSE 中的阶段标识 */
export type TeamStage = 'delegate' | 'execute' | 'final' | 'error' | 'info' | string;

/** 团队流式中单个 Agent 片段（按 agent+stage 累加 content） */
export interface TeamSegment {
  agent: string;
  stage: TeamStage;
  worker?: string;
  subtask?: string;
  error?: string;
  content: string;
}

/**
 * 团队会话在 useXChat 消息存储中的结构
 * 由 TeamChatProvider.transformMessage 累积：一次团队请求对应一条 assistant 消息，
 * 其 team.segments 按 agent+stage 拆分，再由 parser 拆成多个气泡渲染。
 */
export interface TeamChatMessage {
  role: 'assistant';
  /** 兼容单 Agent 路径的 content 字段，团队模式下不参与渲染 */
  content: string;
  team: {
    segments: TeamSegment[];
    /** 后端返回的会话 id，下一轮请求作为 chatId 回传以支持多轮 */
    sessionId?: string;
  };
}

/** 团队气泡渲染消息：parser 从 TeamChatMessage 拆分而来，一个 segment 对应一个气泡 */
export interface TeamBubbleMessage {
  role: 'assistant';
  agent: string;
  stage: TeamStage;
  worker?: string;
  subtask?: string;
  error?: string;
  content: string;
}
