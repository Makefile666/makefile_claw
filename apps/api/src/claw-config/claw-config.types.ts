export interface ModelConfig {
  /** 传给大模型 API 的模型标识（如 gpt-4o），由用户填写 */
  id: string;
  /** 唯一标识，用于 CRUD 操作 */
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
  /** 工具分类（可选，用于 UI 展示） */
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
  /** 角色标签：supervisor 主管 / worker 执行者（仅作能力提示，团队中实际角色由 TeamConfig 决定） */
  role?: 'worker' | 'supervisor';
  /** 能力标签列表，供主管匹配委派（如 ['编码', '审查', '调研']） */
  capabilities?: string[];
  /** 独立子工作区路径（相对工作区根），缺省由编排层按 teamThreadId/workerName 自动生成 */
  workspace?: string;
  /** 该 Agent 最大并发执行数，缺省 2（编排层并发控制用） */
  maxConcurrency?: number;
}

/** 团队协作模式：hierarchy=主管动态委派（模式 C，默认）；pipeline=固定流水线；parallel=并行分治 */
export type TeamMode = 'hierarchy' | 'pipeline' | 'parallel';

/** 团队拓扑连线（pipeline/parallel 模式下描述固定路由；hierarchy 模式下可省略，由主管动态决策） */
export interface TeamEdge {
  /** 源节点名，'__start__' 表示入口 */
  from: string;
  /** 目标节点名，'__end__' 表示结束 */
  to: string;
  /** 触发条件描述（可选） */
  condition?: string;
}

export interface TeamConfig {
  /** 团队名称，唯一键 */
  name: string;
  description: string;
  /** 主管 Agent 名称（必须存在于 agents 配置中） */
  supervisor: string;
  /** 参与的 Worker Agent 名称列表（必须存在于 agents 配置中） */
  workers: string[];
  /** 协作模式，默认 hierarchy */
  mode: TeamMode;
  /** 拓扑连线（pipeline/parallel 模式必填，hierarchy 可选） */
  edges?: TeamEdge[];
  /** 全局最大并行 Worker 数，缺省 3 */
  maxParallelWorkers?: number;
  active: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface McpServerConfig {
  /** 服务器名称，唯一键，仅用于日志区分 */
  name: string;
  /** 远程 MCP 服务器的 Streamable HTTP 端点地址 */
  url: string;
  /** HTTP 请求头，最常见是鉴权用的 Authorization: Bearer <token> */
  headers?: Record<string, string>;
  /** 是否启用（0-未启用，1-已启用），启用后可在 chatbot 页面选择 */
  active: number;
  /** 创建时间（ISO 字符串） */
  createdAt?: string;
  /** 更新时间（ISO 字符串） */
  updatedAt?: string;
}

export interface ClawConfig {
  agents: AgentConfig[];
  models: ModelConfig[];
  tools: ToolConfig[];
  mcpServers: McpServerConfig[];
  /** 多智能体团队编排配置 */
  teams: TeamConfig[];
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

export const DEFAULT_CONFIG: ClawConfig = {
  agents: [],
  models: [],
  tools: BUILTIN_TOOLS,
  mcpServers: [],
  teams: [],
};
