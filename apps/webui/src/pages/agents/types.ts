export interface ModelConfig {
  /** 传给大模型 API 的模型标识（如 gpt-4o） */
  id: string;
  /** 唯一标识，用于 CRUD */
  name: string;
  provider: string;
  base_url: string;
  api_key: string;
  /** API Key 是否从环境变量读取（0-否，1-是），默认 1 */
  api_key_from_env?: number;
  temperature: number;
  active: number;
  description?: string;
}

export interface ToolConfig {
  /** 英文名称，作为唯一键（如 web_search） */
  name: string;
  /** 中文描述 */
  description: string;
  /** 是否启用（0-未启用，1-已启用） */
  active: number;
  /** 是否为内置工具（0-非内置，1-内置） */
  builtin: number;
  /** 工具分类（可选） */
  category?: string;
  /** 工具内部配置项（可选） */
  config?: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  active: number;
}

export interface ClawConfig {
  agents: AgentConfig[];
  models: ModelConfig[];
  tools: ToolConfig[];
}

export const BUILTIN_TOOLS: ToolConfig[] = [
  {
    name: 'web_search',
    description: '通过搜索引擎查询实时信息',
    active: 0,
    builtin: 1,
    category: 'search',
    config: { engine: 'duckduckgo' },
  },
  {
    name: 'code_executor',
    description: '在沙箱中执行 Python / Node.js 代码',
    active: 0,
    builtin: 1,
    category: 'exec',
    config: { runtime: 'python3' },
  },
  {
    name: 'file_operations',
    description: '读写工作目录下的文件',
    active: 0,
    builtin: 1,
    category: 'file',
    config: { workspace: '.' },
  },
  {
    name: 'shell_command',
    description: '执行系统命令行指令',
    active: 0,
    builtin: 1,
    category: 'exec',
    config: { timeout: 30 },
  },
  {
    name: 'http_request',
    description: '发送 HTTP 请求调用外部接口',
    active: 0,
    builtin: 1,
    category: 'network',
    config: { allowRedirects: true },
  },
  {
    name: 'knowledge_base',
    description: '查询本地知识库内容',
    active: 0,
    builtin: 1,
    category: 'search',
    config: { index: 'default' },
  },
];