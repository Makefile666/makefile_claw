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

export type ParsedMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; thinkContent?: string };
