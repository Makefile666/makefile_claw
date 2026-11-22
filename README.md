# makefile_claw

> 一个本地运行的 **AI Agent 智能体工作台**：对话式 Agent 可读写文件、执行命令、操作浏览器，支持 MCP 工具扩展、Skills 技能注入、多模型切换，全部配置与会话状态持久化在本地文件系统，无需数据库。

---

## ✨ 功能特性

- **对话式 AI Agent**：基于 LangChain + LangGraph + deepagents 的流式对话，支持多轮记忆与思考链展示
- **文件 / Shell 沙箱**：Agent 的文件操作被 `virtualMode` 严格限制在工作区目录内，命令执行带超时与输出截断
- **浏览器自动化**：可选启用 Puppeteer MCP，让 Agent 在真实浏览器中运行 / 验证前端代码
- **MCP 工具扩展**：本地 Stdio MCP（文件 / Shell / Puppeteer）+ 远程 Streamable HTTP MCP（如 GitHub MCP）
- **Skills 技能注入**：通过 `skills.sh` 安装技能，技能正文自动注入到 system prompt，引导 Agent 按规范执行任务
- **多模型配置**：在 Web UI 中管理多个 OpenAI 兼容模型（智谱 / DeepSeek / OpenAI 等），按 Agent 绑定切换
- **附件理解**：支持图片（多模态识别）与文档（docx / xlsx / pdf / txt 文本提取）上传
- **会话管理**：会话列表、历史消息、自动 / 手动改名、删除，刷新不丢失（LangGraph 检查点持久化）
- **🤝 多智能体团队协作**：模式 C 主管动态委派，Worker 共享模型与 MCP 工具（AgentPool 池化复用 + McpRegistry 单例）；SSE 分片带 `agent` / `stage` 角色标识；前端团队编排页、CLI 触发、cron 定时任务三种入口；两层持久化 + 工作区隔离，多 Worker 并行写文件不冲突
- **全本地持久化**：无数据库，所有数据存放在 `~/.makefile_claw/`

---

## 🧱 技术栈

| 层 | 技术选型 |
| --- | --- |
| Monorepo | pnpm workspaces（`packages/*`、`apps/*`） |
| 后端 | NestJS 12 + Express · TypeScript 6（ESM）· Vitest · oxlint |
| 前端 | Umi Max 4 + React 19 + Ant Design 6 · `@ant-design/x` / `@ant-design/x-sdk` · React Query · Biome |
| Agent 运行时 | LangChain 1 · LangGraph · **deepagents** · `@modelcontextprotocol/sdk` |
| 文档解析 | `mammoth`（docx）· `xlsx` · `pdf-parse` · `js-yaml` |

---

## 📁 项目结构

```
makefile_claw/
├── apps/
│   ├── api/        # NestJS 后端服务（端口 3000）
│   │   └── src/
│   │       ├── main.ts                 # 启动入口
│   │       ├── app.module.ts           # 模块装配
│   │       ├── claw-config/            # 全局配置读写（含 teams 数据模型）
│   │       ├── agents/  models/  tools/  skills/  mcp/   # 配置 CRUD
│   │       ├── teams/                  # ★ 团队配置 CRUD（/api/teams）
│   │       ├── multi-agent/            # ★ 团队流式接口（/multi-agent/stream，带角色标识 SSE）
│   │       ├── scheduler/              # ★ 定时任务调度（/api/schedules，cron）
│   │       └── models/
│   │           └── models.langchain.controller.ts   # ★ 单 Agent 流式对话核心（SSE）
│   ├── webui/      # Ant Design Pro 前端（端口 8000）
│   │   └── src/
│   │       └── pages/
│   │           ├── chatbot/            # ★ AI 对话主界面（单 Agent / 团队模式切换）
│   │           └── agents/             # Agents / Models / Tools / Skills / Mcp / Teams 配置页
│   └── cli/        # ★ makefile-claw CLI（team run / schedule，非交互触发团队执行）
├── packages/
│   └── agent-core/  # ★ Agent 核心运行时（被 api / cli 依赖）
│       └── src/
│           ├── index.ts                # createMakefileClawAgent — 组装并编译 Agent
│           ├── agents.ts               # 流式模型初始化（含兼容补丁）
│           ├── paths.ts                # ★ 路径解析（支持 MAKEFILE_CLAW_HOME、两层持久化与工作区隔离）
│           ├── readConfig.ts           # 从磁盘读取 agent/model/team 配置
│           ├── pool/                   # ★ AgentPool（模型池化）+ McpRegistry（MCP 单例复用）
│           ├── orchestrator/           # ★ 团队编排引擎：主管动态委派 → Worker 并行 → 汇总
│           ├── FileSaver.js            # LangGraph 检查点持久化
│           └── mcp/                    # 文件/Shell/Puppeteer/远程 MCP 工具加载
├── DESIGN-multi-agent.md  # ★ 多智能体设计文档
└── ARCHITECTURE.md      # 详细架构说明
```

> 想深入了解内部架构、模块职责、数据流与设计约束，请阅读 [ARCHITECTURE.md](./ARCHITECTURE.md)。

---

## 🚀 快速开始

### 环境要求

- **Node.js** ≥ 18（前端 `apps/webui` 要求 ≥ 22）
- **pnpm**（推荐，项目基于 pnpm 管理依赖）
- 一个可用的 **OpenAI 兼容大模型 API**（base_url + api_key）

### 1. 安装依赖

```bash
# 在仓库根目录执行，pnpm 会处理所有 workspace
pnpm install
```

### 2. 启动后端

```bash
cd apps/api
pnpm run start:dev      # 开发模式（热重载），监听 http://localhost:3000
```

### 3. 启动前端

```bash
cd apps/webui
pnpm run dev            # 监听 http://localhost:8000，自动代理 /api → :3000
```

打开浏览器访问 http://localhost:8000 即可。

### 4. 首次配置

首次运行需要先配置模型和 Agent：

1. 打开前端 → **Agents / Models** 页面，添加一个模型（填写 `base_url`、`api_key`）
2. 添加一个 Agent，并绑定刚添加的模型，填写系统提示词
3. 进入 **Chatbot** 页面，选择该 Agent 开始对话

配置会写入 `~/.makefile_claw/makefile_claw.json`，无需重启后端即可生效。

> **多智能体团队模式**：在 **Agents → Teams** 页面新建团队（指定一个主管 + 若干 Worker），即可在 Chatbot 切换到「团队」模式，由主管动态委派多 Worker 协作；也可通过 CLI `makefile-claw team run <团队名> --input "..."` 触发，或在 **Schedules** 页面配置 cron 定时执行。详见 [DESIGN-multi-agent.md](./DESIGN-multi-agent.md)。

---

## ⚙️ 配置与数据

所有数据持久化在用户主目录 `~/.makefile_claw/` 下（无数据库）：

```
~/.makefile_claw/
├── makefile_claw.json      # 全局配置：agents / models / tools / mcpServers / teams
├── memory/
│   ├── <threadId>.json              # 单 Agent 会话检查点（LangGraph，一会话一文件）
│   ├── team-<id>.json               # ★ 团队共享会话状态（两层持久化：团队层）
│   └── team-<id>/                   # ★ 每个 Worker 的独立子检查点（两层持久化：Worker 层）
│       └── <workerName>.json
├── schedules.json           # ★ 定时任务注册记录（CLI 与 API 共享）
├── skills/
│   └── <name>/
│       ├── SKILL.md         # 技能正文（YAML frontmatter + markdown）
│       └── skill.meta.json  # 安装元数据与启用状态
└── workspaces/              # Agent 工作区（文件操作沙箱根）
    └── <teamId>/            # ★ 团队工作区隔离：每个 Worker 独立子目录 + shared/
```

### 可用环境变量

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3000` |
| `MAKEFILE_CLAW_HOME` | 重定向整个数据根目录（配置 / 记忆 / 工作区 / 定时任务），用于隔离或多实例并存 | `~/.makefile_claw` |
| `MAKEFILE_CLAW_WORKSPACE` | Agent 工作区根目录 | `~/.makefile_claw/workspaces` |
| `CHAT_API_URL` | 前端调用的流式对话地址 | `http://localhost:3000/models-streaming` |
| `GITHUB_TOKEN` / `GH_TOKEN` | 检测到则自动连接 GitHub MCP | — |
| `MCP_REMOTE_SERVERS` | 自定义远程 MCP 服务器 JSON 数组 | — |
| `PUPPETEER_EXECUTABLE_PATH` / `CHROME_PATH` | 指定浏览器可执行文件路径 | 自动探测 |
| `OBSERVE_APP_KEY` / `OBSERVE_APP_SECRET` | NestJS Observe 可观测性密钥 | 空（不启用） |

---

## 📜 常用脚本

根目录（一键作用于所有 workspace）：

```bash
pnpm run build    # 构建所有包
pnpm run test     # 运行所有测试
pnpm run lint     # 运行所有 lint
```

后端 `apps/api`：

```bash
pnpm run start:dev      # 开发模式
pnpm run start:prod     # 生产模式
pnpm run test           # 单元测试（Vitest）
pnpm run test:e2e       # 端到端测试
```

前端 `apps/webui`：

```bash
pnpm run dev            # 开发模式（http://localhost:8000）
pnpm run build          # 生产构建
pnpm run preview        # 预览构建产物
pnpm run test           # 单元测试
```

---

## 📚 相关文档

- [DESIGN-multi-agent.md](./DESIGN-multi-agent.md) — 多智能体协作设计（编排引擎、两层持久化、工作区隔离、SSE 协议、CLI / 定时任务）
- [ARCHITECTURE.md](./ARCHITECTURE.md) — 项目整体架构（分层图、模块职责、数据流时序图、设计约束）

---

## 📄 License

MIT
