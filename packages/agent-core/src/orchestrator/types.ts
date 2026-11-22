// 编排引擎公共类型（Task 6-9）
import type { ToolsEnable, RemoteMcpServer } from '../mcp/index.js';

/** 团队配置（agent-core 本地镜像，与 api 层 TeamConfig 对齐；分层架构下允许少量重复） */
export interface TeamConfig {
  name: string;
  description?: string;
  /** 主管 Agent 名称 */
  supervisor: string;
  /** Worker Agent 名称列表 */
  workers: string[];
  mode?: 'hierarchy' | 'pipeline' | 'parallel';
  edges?: Array<{ from: string; to: string }>;
  /** 全局最大并行 Worker 数，默认 3 */
  maxParallelWorkers?: number;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** SSE 分片阶段 */
export type TeamStage = 'delegate' | 'execute' | 'final' | 'error' | 'info';

/** 编排引擎产出的流式事件，API 层将其转为带 agent/stage 的 SSE 分片 */
export interface TeamStreamEvent {
  stage: TeamStage;
  /** 发言者角色名（supervisor 的 agent 名或 worker 的 agent 名），SSE 的 agent 字段 */
  agent: string;
  /** 文本内容分片 */
  content?: string;
  /** 被委派的 worker（delegate 事件） */
  worker?: string;
  /** 子任务描述（delegate 事件） */
  subtask?: string;
  /** 错误信息（error 事件） */
  error?: string;
  ts: string;
}

/** 主管决策的结构化解析结果 */
export interface SupervisorDecision {
  finish: boolean;
  summary?: string;
  /** 委派目标：单个 worker 名或多个（并行） */
  delegate?: string | string[];
  subtask?: string;
  /** 是否成功从模型输出解析出合法 JSON；false 时触发重试/降级 */
  parsed: boolean;
  /** 模型原始输出（用于日志/降级归因） */
  raw?: string;
}

/** 运行团队任务的选项 */
export interface RunTeamOptions {
  /** 注入给 Worker 的技能正文 */
  skillsContent?: string;
  /** Worker 工具开关，默认全开 file+shell+puppeteer+web */
  toolsEnable?: ToolsEnable;
  /** 主管最大委派轮次，默认 8，防止无限循环 */
  maxRounds?: number;
  /** 外部中止信号 */
  signal?: AbortSignal;
  /** 选中的远程 MCP 服务器 */
  mcpServers?: RemoteMcpServer[];
  /** 事件观察者（用于结构化日志，不影响流） */
  onEvent?: (ev: TeamStreamEvent) => void;
}
