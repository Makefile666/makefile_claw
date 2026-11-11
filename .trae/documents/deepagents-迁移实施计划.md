# deepagents 迁移实施计划

## Context（背景与目标）

当前 `makefile_claw` 项目的 Agent 基于 LangChain `createAgent` + 两个 MCP 子进程（file/server-filesystem、shell/mcp-shell-server）构建。用户要求：

1. 用 **deepagents（npm 包 1.16.3）的 `createDeepAgent`** 取代 langchain `createAgent`
2. 用 **deepagents 内置文件+shell 工具**（`LocalShellBackend` + `createFilesystemMiddleware`）取代现有 MCP file/shell 工具，不再拉起 MCP 子进程
3. 思维链组件改用 **ant-design-x 的 `ThoughtChain`**（替代现有 `<Think>`），参考用户已做好的思维链提取能力
4. 保留：per-request 技能选择注入 system prompt、FileSaver checkpointer 会话持久化、OpenAI SSE 格式与前端 `OpenAIChatProvider` 兼容、RUN\_TIMEOUT/IDLE\_TIMEOUT 超时控制、按名加载 Agent 配置

**已确认的决策**（用户选定）：

* 工具集 = `createFilesystemMiddleware({ backend })` + `todoListMiddleware()`（write\_todos 待办工具），与用户 demo（`langchain_ts/packages/langchain-ts/deepagents/deepagents-tools.js`）一致
* **保留 grep 工具**（依赖 ripgrep 二进制，实施时验证 rg 可用性；不可用则引导模型用 glob+read\_file）

**已验证的关键事实**（来自 deepagents 1.16.3 打包源码与 .d.ts）：

* `LocalShellBackend.execute` = `spawn(command, { shell: true, env, cwd })` → Windows 走 cmd.exe（非 PowerShell）；`inheritEnv` 默认 false → env 为空，**必须设 `inheritEnv: true`**；`timeout` 秒级，默认 120
* 内置工具 8 个：ls/read\_file/write\_file/edit\_file/delete/glob/grep/execute；`execute` 仅在 backend 支持命令执行时可见；`grep` 底层 `spawn("rg", ...)`
* `createDeepAgent` 异步返回，agent 继承 `invoke/stream/streamEvents`；`streamMode: "messages"` 下 chunk 仍是 `[messageChunk, metadata]` 元组
* deepagents peerDeps：`langchain ^1.6.2`、`@langchain/core ^1.3.4`、`@langchain/langgraph ^1.6.1`、`@langchain/langgraph-checkpoint ^1.1.5`、`langsmith >=0.7.1 <0.10.0`、`@langchain/openai ^1.6.3`（optional）
* `FileSaver extends MemorySaver`（@langchain/langgraph re-export 自 @langchain/langgraph-checkpoint），与 deepagents 要求的 BaseCheckpointSaver 同类，无冲突
* ant-design-x 2.9.0 `ThoughtChain`：`items: ThoughtChainItemType[]`，item 含 `key/title/description/content/status('loading'|'success'|'error'|'abort')/collapsible/blink`

## 实施步骤

### S1 依赖升级

**`packages/agent-core/package.json`**：

* `langchain`: `1.3.5` → `^1.6.2`（deepagents peer 硬要求）
* `@langchain/langgraph`: `1.7.0` → `1.7.2`（对齐 langchain 1.6.x peer）
* 新增：`deepagents: ^1.16.3`、`@langchain/langgraph-checkpoint: ^1.1.5`、`langsmith: ">=0.7.1 <0.10.0"`
* 删除：`@modelcontextprotocol/sdk`（MCP 全部移除）

**`apps/api/package.json`**：`langchain` 升 `^1.6.2`（与 agent-core 对齐）。

**验证**：

```powershell
cd d:\AI项目二\makefile_claw
pnpm install
pnpm why langchain                              # 确认无 1.3.5/1.6.2 双版本
pnpm why @langchain/langgraph-checkpoint        # 确认单版本
pnpm why @langchain/openai                      # 确认版本，如被拉高需复查智谱 role 修复
```

### S2 agent-core 改造

**`packages/agent-core/src/index.ts`** — `createMakefileClawAgent` 重写：

```ts
import { createDeepAgent, createFilesystemMiddleware, LocalShellBackend } from 'deepagents';
import { todoListMiddleware } from 'langchain';
// 删除：createAgent/tool 导入、@modelcontextprotocol/sdk、spawn/exec、terminal-registry 相关导入

export async function createMakefileClawAgent(agentName, threadId, toolsEnable, skillsContent) {
  // 1) FileSaver checkpointer（不变）
  const filePath = path.join(os.homedir(), '.makefile_claw', 'memory', threadId + '.json');
  const checkpointer = new FileSaver(filePath);

  // 2) 模型（不变）：readConfigByAgentName → readConfigByModelName → initStreamModel
  const agentconfig = readConfigByAgentName(agentName);
  const modelconfig = readConfigByModelName(agentconfig.model);
  const model = await initStreamModel(modelconfig);

  // 3) LocalShellBackend 取代 MCP 子进程
  const workspace = process.env.MAKEFILE_CLAW_WORKSPACE ?? process.cwd();
  const backend = await LocalShellBackend.create({
    rootDir: path.resolve(workspace),   // 项目工作目录；virtualMode:false 允许绝对路径穿透（技能脚本）
    virtualMode: false,
    inheritEnv: true,                   // 必须！否则 cmd.exe 空环境找不到 PATH
    timeout: 300,                       // 对齐原 MCP_SHELL_MAX_EXECUTION_TIME=300
    maxOutputBytes: 100_000,
  });

  // 4) system prompt（保留原逻辑）：agentconfig.systemPrompt + 终端工具说明（改为 cmd.exe 语法说明）+ skillsContent 追加段
  //    【终端工具说明】改为：Windows 下 execute 走 cmd.exe（dir/type/findstr），文件查找优先用内置 grep/glob 工具

  // 5) 创建 deepagent
  const agent = await createDeepAgent({
    model,
    systemPrompt: finalSystemPrompt,
    middleware: [todoListMiddleware(), createFilesystemMiddleware({ backend })],
    backend,
    checkpointer,
    name: agentName,
  });

  // 6) close = backend.close()（无进程树清理，execute 每次是短命子进程）
  const close = async () => { await backend.close(); };
  return { agent, close, checkpointer };
}
```

**删除**：`loadMcpTools`/`loadMcpFileTools`/`loadMcpShellTools`/`convertMcpToolsToLangChainTools`/`killMcpTree`/`KILL_TREE_TIMEOUT_MS` 及 MCP 相关导入；`packages/agent-core/src/terminal-registry.ts` 整文件（含 `withTimeout`/`parseMcpTextResult`/`createTerminalRegistry` 等残留）。

**删除后全局检查**：grep `loadMcpTools|terminal-registry|@modelcontextprotocol|killMcpTree` 全仓库无残留（`apps/api` 也不应再引用）。

### S3 controller 适配

**`apps/api/src/models/models.langchain.controller.ts`**：

1. `createMakefileClawAgent` 调用签名不变（返回值结构相同），无需大改调用处；`finally` 里 `close()` 语义已变（不再杀进程树）
2. 流式循环改造为结构化思维链协议（状态机）：

```
协议：<think> 容器内嵌 <node title="...">内容</node>，工具调用/结果也作为 node
```

```ts
const TOOL_TITLE: Record<string, string> = {
  execute: '执行命令', read_file: '读取文件', write_file: '写入文件',
  edit_file: '编辑文件', ls: '列出目录', glob: '查找文件', grep: '搜索内容', delete: '删除文件',
};
let openNode: NodeKind = null;      // 'think' | 'tool' | 'tool_result' | null
let thinkOpened = false;
const toolNameById = new Map<string, string>();   // tool_call_id -> 工具名（用于工具结果 title 反查）

// 循环内分支（在现有 reasoning/aiContent/hasToolCalls/isToolResult 提取之后）：
if (hasThinking) {
  if (openNode !== 'think') openNode('思考', 'think');
  emit(String(reasoning));
}
if (hasToolCalls) {
  const tc = messageChunk.tool_calls[0];
  toolNameById.set(tc.id, tc.name);
  openNode(`${TOOL_TITLE[tc.name] ?? tc.name}`, 'tool');
  emit(tc.args ? JSON.stringify(tc.args) : '');
}
if (isToolResult) {
  const name = toolNameById.get(messageChunk.tool_call_id) ?? '';
  openNode(`工具结果 ${name}`, 'tool_result');
  emit(aiContent.length > 200 ? aiContent.slice(0, 200) + '…' : aiContent);
}
if (hasAnswer && !hasToolCalls && !isToolResult) {
  closeThink();      // 闭合 </think>，正文在容器外下发
  emit(aiContent);
}
// 循环结束兜底 closeThink()
```

辅助函数：`openNode(title, kind)` 内先 `closeNode()`（有 open 则 emit `</node>`）、首次时 emit `<think>`；`closeThink()` = closeNode + emit `</think>`。

3. catch 分支：错误提示前 emit `<think><node title="错误">错误信息</node></think>`
4. `getSessionMessages`（历史消息回放）：把 reasoning 转 `<think><node title="思考">...</node></think>`，保持与流式渲染一致（非阻塞项，可后置）

### S4 前端改造

**`apps/webui/src/pages/chatbot/data.d.ts`**：

```ts
export interface ThoughtNode {
  key: string;
  title: string;
  content: string;
  status: 'loading' | 'success' | 'error';
}
export type ParsedMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; thoughtItems?: ThoughtNode[] };
```

**`apps/webui/src/pages/chatbot/index.tsx`**：

1. `parser`：提取 `<think>` 块（含未闭合）→ 按 `<node title="...">...</node>` 正则拆分 → 生成 `thoughtItems`（闭合=success、未闭合=loading、title==='错误'=error）
2. `bubbleItems`：`item.header` 用 `ThoughtChain` 替换 `<Think>`：

```tsx
if (isAI && parsed.thoughtItems?.length) {
  item.header = (
    <ThoughtChain
      collapsible
      items={parsed.thoughtItems.map((n) => ({
        key: n.key,
        title: n.title,
        content: <XMarkdown streaming={getStreamingConfig(msg.status)}>{n.content}</XMarkdown>,
        status: n.status,
        blink: n.status === 'loading',
      }))}
    />
  );
}
```

3. 从 `@ant-design/x` 导入 `ThoughtChain`（`Think` 移除）

## 风险清单

| 风险                                                                                         | 缓解                                                                       |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| execute 走 cmd.exe 非 PowerShell，模型可能发 ls/cat 等 POSIX 命令                                     | systemPrompt【终端工具说明】改为 cmd 语法引导；实测模型行为                                   |
| inheritEnv 遗漏 → cmd 空环境全失败                                                                 | 代码强制 `inheritEnv: true`                                                  |
| grep 依赖 rg 二进制，Windows 可能未装                                                                | 保留 grep（用户已确认）；联调时验证，不可用则引导 glob+read\_file                              |
| langchain 1.6.x 升级的 breaking changes（initStreamModel 的 ChatOpenAI 选项、智谱 role monkey-patch） | S1 后先跑 `pnpm run build`（tsc）暴露类型错误；联调后检查 memory json 无 `role: undefined` |
| deepagents 默认中间件被覆盖（已显式传 middleware）                                                       | 只传 todoList + filesystem，避免 subagent/task 内置提示词干扰                        |
| execute 派生后台进程孤儿化（close 不杀进程树）                                                             | 命令保持短任务；不做额外清理（避免过度设计）                                                   |
| 旧 MCP 残留引用                                                                                 | S2 后全仓库 grep 验证                                                          |

## 验证方案

```powershell
cd d:\AI项目二\makefile_claw\packages\agent-core; pnpm run build     # tsc
cd d:\AI项目二\makefile_claw\apps\api; pnpm run build               # nest build
cd d:\AI项目二\makefile_claw\apps\webui; pnpm run build             # max build
```

端到端（api: `pnpm run start:dev`；webui: `pnpm run start`）：

1. 问"列出项目根目录文件" → 日志无 MCP 子进程/REGISTRY 输出，SSE 出现 `<think><node title="思考">` 与 `<node title="列出目录 ls">`、`<node title="工具结果 ls">`
2. 问"运行 npm --version" → execute 经 cmd.exe 返回输出（验证 inheritEnv）
3. 问需 grep 的问题 → 验证 rg 可用性（风险触发点）
4. 多轮对话 → `~/.makefile_claw/memory/<threadId>.json` 恢复上下文正常
5. 前端观察 ThoughtChain：loading 闪烁 → success；错误场景 error 节点
6. 检查 memory json 无 `role: undefined`（智谱 role 修复在升级后仍生效）
7. 复杂任务验证 RUN\_TIMEOUT 300s / IDLE\_TIMEOUT 90s 仍可 abort，finally 清理正常

## Critical Files

* `d:\AI项目二\makefile_claw\packages\agent-core\src\index.ts`（核心：createDeepAgent + LocalShellBackend + 删 MCP）
* `d:\AI项目二\makefile_claw\packages\agent-core\package.json`（依赖升级）
* `d:\AI项目二\makefile_claw\apps\api\src\models\models.langchain.controller.ts`（SSE 思维链 node 协议 + close 适配）
* `d:\AI项目二\makefile_claw\apps\api\package.json`（langchain 对齐）
* `d:\AI项目二\makefile_claw\apps\webui\src\pages\chatbot\index.tsx`（parser + ThoughtChain）
* `d:\AI项目二\makefile_claw\apps\webui\src\pages\chatbot\data.d.ts`（ThoughtNode/ParsedMessage 类型）
* 删除：`d:\AI项目二\makefile_claw\packages\agent-core\src\terminal-registry.ts`
