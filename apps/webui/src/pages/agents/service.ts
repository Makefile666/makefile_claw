import { request } from '@umijs/max';
import { BUILTIN_TOOLS } from './types';
import type {
  AgentConfig,
  ClawConfig,
  ModelConfig,
  ToolConfig,
} from './types';
/**
 * 【重要】后端接口契约规划
 * GET    /api/claw/config  -> 获取完整 ClawConfig 配置
 * PUT    /api/claw/config  -> 保存完整配置文件到 .makefile_claw/makefile_claw.json（models 字段受保护，不会被覆盖）
 *
 * 当前策略：
 * 1. getMakefileClawAgentsConfig 是对接后端的读取接口（已经写好request）
 * 2. getClawConfig / saveClawConfig 是 localStorage 本地兜底，仅调试用
 *
 * ✅ 各模块数据源：
 * - Agent：细粒度 REST 接口 GET/POST/PUT/DELETE /api/agents
 * - Model：细粒度 REST 接口 GET/POST/PUT/DELETE /api/models（name 为唯一标识）
 * - Tools：细粒度 REST 接口 GET/POST/PUT/DELETE /api/tools（name 为唯一标识）
 */
const STORAGE_KEY = 'makefile_claw_config';
/**
 * 【重要】后端接口基础地址
 * 环境变量 UMI_APP_API_BASE_URL 优先级最高
 * 没配置环境变量默认 /api，配合 umi proxy 开发反向代理
 * 打包生产时，可以配置成完整域名 https://xxx.com/api
 */
const BASE_URL = process.env.UMI_APP_API_BASE_URL ?? '/api';
/**
 * 默认配置兜底模板
 * agents 空数组、models 空数组、tools 直接使用内置工具常量
 * 当 localStorage 为空 / 解析失败时返回这份默认数据
 */
const DEFAULT_CONFIG: ClawConfig = {
  agents: [],
  models: [],
  tools: BUILTIN_TOOLS,
};
/**
 * 【重点兼容迁移函数】migrateAgent
 * 作用：兼容老版本存储里的 agent 数据结构，做字段归一化
 * 旧字段兼容：modelId 映射到 model；tools 支持老格式对象数组提取 id；补全 active 默认值、createdAt
 * 防止老缓存数据结构不对，页面渲染报错
 * @param raw 从存储里读出来的原始、可能不规范的agent对象
 * @returns 标准化之后符合 AgentConfig 类型的对象
 */
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
/**
 * 【本地读取核心】readConfig
 * 读取 localStorage 里的配置字符串，JSON.parse 解析
 * 对 agents 批量执行 migrateAgent 做数据结构兼容迁移
 * tools 逻辑：如果存储里没有tools，就回退成内置 BUILTIN_TOOLS
 * try-catch：防止 json 损坏、非法格式，直接返回默认配置，页面不崩溃
 * ⚠️ 仅读取浏览器本地缓存，不会请求后端
 */
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
/**
 * 【本地写入核心】writeConfig
 * 将完整 ClawConfig 对象序列化，存入 localStorage
 * 所有 create / update / delete 本地方法最终都会调用它持久化
 * ⚠️ 仅写入浏览器本地缓存，不会同步到Nest后端服务
 */
const writeConfig = (config: ClawConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};
// ---------- 全局配置读写【本地兜底版本】 ----------
/**
 * 本地读取全量配置，TODO：后续替换成后端GET接口
 * 页面调试、离线模式用这个，不走网络请求
 * ⚠️ 调试专用，上线页面不要调用该函数，优先使用 getMakefileClawAgentsConfig
 */
export async function getClawConfig(): Promise<ClawConfig> {
  return readConfig();
}
/**
 * 本地保存全量配置，TODO：后续替换成后端PUT接口
 * 完整覆盖保存整个配置对象
 * ⚠️ 调试专用，只存localStorage，不会同步后端
 */
export async function saveClawConfig(config: ClawConfig): Promise<ClawConfig> {
  writeConfig(config);
  return config;
}
/**
 * 从后端 GET /claw/config 拉取完整配置
 * 返回结构是后端约定包装体 {code, data:ClawConfig, msg}
 * 用途：Agents 页面一次性获取 agents+models+tools 三组数据；Tools 模块也通过此接口读取
 * 注意：Models 模块不再通过本接口读取，而是走独立的 getMakefileClawModelsConfig() -> GET /api/models
 */
export async function getMakefileClawAgentsConfig(): Promise<ClawConfig> {
  const res = await request<{ code: number; data: ClawConfig; msg: string }>(
    `${BASE_URL}/claw/config`,
    { method: 'GET' },
  );
  return res.data;
}
/**
 * 整体保存配置到后端 PUT /claw/config
 * 用途：Tools 模块（toggleTool / updateToolConfig）修改工具配置后整体回写
 * ⚠️ 后端已对 models 字段做保护：本接口不会覆盖磁盘上的 models 数据，
 *    models 的增删改请统一走 /api/models 独立接口，避免并发互相覆盖。
 */
export async function saveMakefileClawAgentsConfig(config: ClawConfig): Promise<ClawConfig> {
  const res = await request<{ code: number; data: ClawConfig; msg: string }>(
    `${BASE_URL}/claw/config`,
    { method: 'PUT', data: config },
  );
  return res.data;
}
// ---------- Agents 增删改查【后端版】 ----------
// 对接后端 /api/agents REST 接口，保证与列表页数据源一致
// ✅ Agent 独立细粒度接口：每次只提交单条agent数据，不需要传递整个配置对象，并发更安全
/**
 * 获取Agent列表，请求后端 GET /agents
 */
export async function listAgents(): Promise<AgentConfig[]> {
  const res = await request<{ code: number; data: AgentConfig[]; msg: string }>(
    `${BASE_URL}/agents`,
    { method: 'GET' },
  );
  return res.data;
}
/**
 * 新建Agent，请求后端 POST /agents
 * ✅ id、createdAt 在后端生成，前端不需要构造
 */
export async function createAgent(agent: Omit<AgentConfig, 'id' | 'createdAt'>): Promise<AgentConfig> {
  const res = await request<{ code: number; data: AgentConfig; msg: string }>(
    `${BASE_URL}/agents`,
    { method: 'POST', data: agent },
  );
  return res.data;
}
/**
 * 更新Agent，请求后端 PUT /agents/:id
 * ✅ 仅传递需要修改的字段patch，不需要传完整agent对象
 */
export async function updateAgent(id: string, patch: Partial<AgentConfig>): Promise<AgentConfig | undefined> {
  const res = await request<{ code: number; data: AgentConfig; msg: string }>(
    `${BASE_URL}/agents/${id}`,
    { method: 'PUT', data: patch },
  );
  return res.data;
}
/**
 * 删除Agent，请求后端 DELETE /agents/:id
 */
export async function deleteAgent(id: string): Promise<void> {
  await request<{ code: number; data: null; msg: string }>(
    `${BASE_URL}/agents/${id}`,
    { method: 'DELETE' },
  );
}
// ---------- Models 增删改查【独立 REST 接口】 ----------
// 对接后端 /api/models，不再通过 GET/PUT /claw/config 全量读写
// name 为唯一标识：GET/PUT/DELETE /api/models/:name
/**
 * 从后端 GET /api/models 获取模型列表
 * 返回 {code, data: ModelConfig[], msg}，取 data 返回
 * 与 getMakefileClawAgentsConfig 风格一致，Models 模块的读取入口
 */
export async function getMakefileClawModelsConfig(): Promise<ModelConfig[]> {
  const res = await request<{ code: number; data: ModelConfig[]; msg: string }>(
    `${BASE_URL}/models`,
    // GET：后端 → 前端，拉取全部model列表
    { method: 'GET' },
  );
  return res.data;
}

/*
    ** 前端把表单数据发给后端的入口 **，完整链路：

      1. 表单校验通过 → 拿到表单对象
      2. 调用 `createModel(表单数据)`
      3. `request`（umi 封装的 axios）发起 POST
      4. 表单对象放到 `data` 里，序列成 JSON 放在请求体
      5. 发到你 Nest 的 `@Controller('api/models')` 里的 `@Post()` 接口
*/
export async function createModel(model: Omit<ModelConfig, 'createdAt'>): Promise<ModelConfig> {
  const res = await request<{ code: number; data: ModelConfig; msg: string }>(
    `${BASE_URL}/models`,
    // POST：前端 → 后端，提交表单、新增一条model
    { method: 'POST', data: model },
  );
  return res.data;
}

export async function updateModel(name: string, patch: Partial<ModelConfig>): Promise<ModelConfig | undefined> {
  const res = await request<{ code: number; data: ModelConfig; msg: string }>(
    `${BASE_URL}/models/${name}`,
    { method: 'PUT', data: patch },
  );
  return res.data;
}

export async function deleteModel(name: string): Promise<void> {
  await request<{ code: number; data: null; msg: string }>(
    `${BASE_URL}/models/${name}`,
    { method: 'DELETE' },
  );
}
// ---------- Tools【独立 REST 接口】 ----------
// 工具由系统内置管理，前端仅需：列表查询 + 启用状态切换
// 后端保留完整 CRUD 接口供其他场景使用，前端不调用 create/delete
/**
 * 从后端 GET /api/tools 获取工具列表
 * 返回 {code, data: ToolConfig[], msg}，取 data 返回
 * 与 getMakefileClawModelsConfig 风格一致，Tools 模块的读取入口
 */
export async function getMakefileClawToolsConfig(): Promise<ToolConfig[]> {
  const res = await request<{ code: number; data: ToolConfig[]; msg: string }>(
    `${BASE_URL}/tools`,
    { method: 'GET' },
  );
  return res.data;
}

/**
 * 切换工具启用状态（active 0/1）
 * 仅传 active 字段，其余字段由后端保留
 */
export async function updateTool(name: string, patch: Pick<ToolConfig, 'active'>): Promise<ToolConfig | undefined> {
  const res = await request<{ code: number; data: ToolConfig; msg: string }>(
    `${BASE_URL}/tools/${name}`,
    { method: 'PUT', data: patch },
  );
  return res.data;
}
