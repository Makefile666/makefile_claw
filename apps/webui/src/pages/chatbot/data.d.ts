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
