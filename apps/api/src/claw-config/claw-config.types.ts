export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  description?: string;
  createdAt: number;
}

export interface ToolConfig {
  id: string;
  name: string;
  description: string;
  category: string;
  builtin: boolean;
  enabled: boolean;
  config?: Record<string, unknown>;
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  active: number;
  createdAt: number;
}

export interface ClawConfig {
  agents: AgentConfig[];
  models: ModelConfig[];
  tools: ToolConfig[];
}

export const BUILTIN_TOOLS: ToolConfig[] = [
  {
    id: 'web_search',
    name: 'Web Search',
    description: '通过搜索引擎查询实时信息',
    category: 'search',
    builtin: true,
    enabled: false,
    config: { engine: 'duckduckgo' },
  },
  {
    id: 'code_executor',
    name: 'Code Executor',
    description: '在沙箱中执行 Python / Node.js 代码',
    category: 'exec',
    builtin: true,
    enabled: false,
    config: { runtime: 'python3' },
  },
  {
    id: 'file_operations',
    name: 'File Operations',
    description: '读写工作目录下的文件',
    category: 'file',
    builtin: true,
    enabled: false,
    config: { workspace: '.' },
  },
  {
    id: 'shell_command',
    name: 'Shell Command',
    description: '执行系统命令行指令',
    category: 'exec',
    builtin: true,
    enabled: false,
    config: { timeout: 30 },
  },
  {
    id: 'http_request',
    name: 'HTTP Request',
    description: '发送 HTTP 请求调用外部接口',
    category: 'network',
    builtin: true,
    enabled: false,
    config: { allowRedirects: true },
  },
  {
    id: 'knowledge_base',
    name: 'Knowledge Base',
    description: '查询本地知识库内容',
    category: 'search',
    builtin: true,
    enabled: false,
    config: { index: 'default' },
  },
];

export const DEFAULT_CONFIG: ClawConfig = {
  agents: [],
  models: [],
  tools: BUILTIN_TOOLS,
};
