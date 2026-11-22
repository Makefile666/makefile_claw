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
  mcpServers: McpServerConfig[];
}

/** 团队协作模式：hierarchy=主管动态委派（默认）；pipeline=固定流水线；parallel=并行分治 */
export type TeamMode = 'hierarchy' | 'pipeline' | 'parallel';

/**
 * 多智能体团队配置
 * 对应后端 ~/.makefile_claw/makefile_claw.json 中的 teams 数组
 * name 为唯一键；supervisor / workers 均引用 agents 配置中的 Agent 名称
 */
export interface TeamConfig {
  /** 团队名称，唯一键 */
  name: string;
  /** 团队简要描述 */
  description?: string;
  /** 主管 Agent 名称（必须存在于 agents 配置中） */
  supervisor: string;
  /** 参与的 Worker Agent 名称列表 */
  workers: string[];
  /** 协作模式，默认 hierarchy */
  mode?: TeamMode;
  /** 全局最大并行 Worker 数，缺省 3 */
  maxParallelWorkers?: number;
  /** 是否启用（0-未启用，1-已启用） */
  active?: number;
}

/**
 * MCP 服务器配置
 * 对应后端 ~/.makefile_claw/makefile_claw.json 中的 mcpServers 数组
 */
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

/**
 * Skill 技能配置
 * 对应后端 ~/.makefile_claw/skills/<name>/SKILL.md 解析结果
 */
export interface SkillConfig {
  /** 技能英文名称（唯一键，即技能文件夹名） */
  name: string;
  /** 技能简要描述 */
  description: string;
  /** 技能版本号（可选） */
  version?: string;
  /** 允许使用的工具列表（可选） */
  allowedTools?: string[];
  /** 技能正文内容（SKILL.md 中 --- 之后的 markdown 规范文档） */
  content: string;
  /** SKILL.md 所在文件夹绝对路径 */
  skillDir: string;
  /** SKILL.md 文件绝对路径 */
  skillPath: string;
  /** 技能来源（GitHub repo 地址或 owner/repo） */
  source?: string;
  /** 安装时间（ISO 字符串） */
  installTime?: string;
  /** 安装时使用的命令 */
  installCommand?: string;
  /** 是否启用（true-启用，false-停用），停用后不会注入到 Agent */
  active: boolean;
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