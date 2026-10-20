import { BUILTIN_TOOLS } from './types';
import type {
  AgentConfig,
  ClawConfig,
  ModelConfig,
  ToolConfig,
} from './types';

/**
 * 后端接口契约（待后端实现后替换 localStorage 实现）：
 *   GET    /api/claw/config                 -> ClawConfig
 *   PUT    /api/claw/config                 -> 保存完整配置到 .makefile_claw/makefile_claw.json
 *
 * 以下 service 当前使用 localStorage 作为本地存储兜底，确保前端可独立运行。
 */

const STORAGE_KEY = 'makefile_claw_config';

const DEFAULT_CONFIG: ClawConfig = {
  agents: [],
  models: [],
  tools: BUILTIN_TOOLS,
};

/** 兼容旧版 Agent 字段：modelId -> model, tools 归一化为 string[], 补 active:1 */
const migrateAgent = (raw: Record<string, unknown>): AgentConfig => {
  const tools = Array.isArray(raw.tools)
    ? raw.tools
        .map((t) => (typeof t === 'string' ? t : (t as { id?: string })?.id))
        .filter((id): id is string => !!id)
    : [];
  return {
    id: String(raw.id ?? ''),
    name: String(raw.name ?? ''),
    description: String(raw.description ?? ''),
    model: String(raw.model ?? raw.modelId ?? ''),
    systemPrompt: String(raw.systemPrompt ?? ''),
    tools,
    active: typeof raw.active === 'number' ? raw.active : 1,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
  };
};

const readConfig = (): ClawConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_CONFIG);
    const parsed = JSON.parse(raw) as Partial<ClawConfig>;
    return {
      agents: (parsed.agents ?? []).map((a) => migrateAgent(a as unknown as Record<string, unknown>)),
      models: parsed.models ?? [],
      tools: parsed.tools?.length ? parsed.tools : structuredClone(BUILTIN_TOOLS),
    };
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
};

const writeConfig = (config: ClawConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

// ---------- 配置整体读写 ----------

export async function getClawConfig(): Promise<ClawConfig> {
  // TODO: 替换为 request('/api/claw/config')
  return readConfig();
}

export async function saveClawConfig(config: ClawConfig): Promise<ClawConfig> {
  // TODO: 替换为 request('/api/claw/config', { method: 'PUT', data: config })
  writeConfig(config);
  return config;
}

// ---------- Agents ----------

export async function listAgents(): Promise<AgentConfig[]> {
  return readConfig().agents;
}

export async function createAgent(agent: Omit<AgentConfig, 'id' | 'createdAt'>): Promise<AgentConfig> {
  const config = readConfig();
  const newAgent: AgentConfig = {
    ...agent,
    id: `agent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  config.agents.push(newAgent);
  writeConfig(config);
  return newAgent;
}

export async function updateAgent(id: string, patch: Partial<AgentConfig>): Promise<AgentConfig | undefined> {
  const config = readConfig();
  const idx = config.agents.findIndex((a) => a.id === id);
  if (idx === -1) return undefined;
  config.agents[idx] = { ...config.agents[idx], ...patch };
  writeConfig(config);
  return config.agents[idx];
}

export async function deleteAgent(id: string): Promise<void> {
  const config = readConfig();
  config.agents = config.agents.filter((a) => a.id !== id);
  writeConfig(config);
}

// ---------- Models ----------

export async function listModels(): Promise<ModelConfig[]> {
  return readConfig().models;
}

export async function createModel(model: Omit<ModelConfig, 'id' | 'createdAt'>): Promise<ModelConfig> {
  const config = readConfig();
  const newModel: ModelConfig = {
    ...model,
    id: `model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  config.models.push(newModel);
  writeConfig(config);
  return newModel;
}

export async function updateModel(id: string, patch: Partial<ModelConfig>): Promise<ModelConfig | undefined> {
  const config = readConfig();
  const idx = config.models.findIndex((m) => m.id === id);
  if (idx === -1) return undefined;
  config.models[idx] = { ...config.models[idx], ...patch };
  writeConfig(config);
  return config.models[idx];
}

export async function deleteModel(id: string): Promise<void> {
  const config = readConfig();
  config.models = config.models.filter((m) => m.id !== id);
  writeConfig(config);
}

// ---------- Tools ----------

export async function listTools(): Promise<ToolConfig[]> {
  return readConfig().tools;
}

export async function toggleTool(id: string, enabled: boolean): Promise<ToolConfig | undefined> {
  const config = readConfig();
  const idx = config.tools.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  config.tools[idx] = { ...config.tools[idx], enabled };
  writeConfig(config);
  return config.tools[idx];
}

export async function updateToolConfig(id: string, configPatch: Record<string, unknown>): Promise<ToolConfig | undefined> {
  const config = readConfig();
  const idx = config.tools.findIndex((t) => t.id === id);
  if (idx === -1) return undefined;
  config.tools[idx] = { ...config.tools[idx], config: { ...config.tools[idx].config, ...configPatch } };
  writeConfig(config);
  return config.tools[idx];
}
