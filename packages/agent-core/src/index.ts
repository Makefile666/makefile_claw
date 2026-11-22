import { readConfig, readConfigByAgentName, readConfigByModelName } from './readConfig.js';
import { initStreamModel } from './agents.js';
import { createModel } from './LLM_instance.js';
import { SystemMessage, HumanMessage, AIMessage, todoListMiddleware } from 'langchain';

export { readConfig, readConfigByAgentName, readConfigByModelName, initStreamModel, createModel };

import path from 'node:path';
import os from 'node:os';

// @ts-ignore - FileSaver 是纯 JS 模块，暂无类型声明文件
import { FileSaver } from "./FileSaver.js"

// deepagents：内置文件 + shell 工具（LocalShellBackend），作为 Agent 的基础工具集
import {
    createDeepAgent,
    createFilesystemMiddleware,
    LocalShellBackend,
} from 'deepagents';

// MCP 工具集成：通过 Stdio 拉起文件 MCP 与 Shell MCP 服务，转换为 LangChain 工具，
// 作为额外工具叠加到 deepagents 框架之上（createDeepAgent.tools 参数）
import { loadMcpTools } from './mcp/index.js';
import type { ToolsEnable, RemoteMcpServer, LoadedMcpTools } from './mcp/index.js';
import { ensureDir, getLegacyCheckpointFile } from './paths.js';

export type { ToolsEnable, RemoteMcpServer, LoadedMcpTools };

/** createMakefileClawAgent 的可选扩展参数（多智能体编排用；单 Agent 可不传） */
export interface AgentCreateOptions {
  /** 自定义检查点文件路径（团队 Worker 子检查点用）；缺省走旧路径 memory/<threadId>.json */
  checkpointFile?: string;
  /** 自定义工作区目录（团队 Worker 子工作区用）；缺省走 ~/.makefile_claw/workspaces */
  workspaceDir?: string;
  /** 团队共享产物目录，会在 system prompt 中告知 Worker 用于跨 Worker 传文件 */
  sharedDir?: string;
  /** 预加载的 MCP 工具（来自 AgentPool 共享注册表），传入则跳过 loadMcpTools，实现子进程复用 */
  mcpTools?: LoadedMcpTools;
  /** 复用的模型实例（来自 AgentPool 缓存），传入则跳过 initStreamModel，避免重复建连 */
  model?: any;
}

/**
 * 创建 deepagents 智能体（内置文件+Shell 工具）并叠加 MCP 工具
 * @param agentName 智能体名称
 * @param threadId 会话ID
 * @param toolsEnable 工具开关配置（fileTools / shellTools / webTools）
 * @param skillsContent 选中技能的正文内容（会追加到 system prompt 末尾，注入给 Agent 作为任务规范上下文）
 */
export async function createMakefileClawAgent(agentName: string, threadId: string, toolsEnable: ToolsEnable = { fileTools: true, shellTools: true, webTools: true }, skillsContent = '', opts: AgentCreateOptions = {}): Promise<{ agent: any; close: () => Promise<void>; checkpointer: any }> {
    // ===== 第一块：准备会话持久化检查点 =====
    // 单 Agent 走旧路径 memory/<threadId>.json；团队 Worker 子检查点通过 opts.checkpointFile 指向子目录，
    // 实现「团队共享状态 + 每个 Worker 独立子状态」的两层持久化。
    const filePath = opts.checkpointFile ?? getLegacyCheckpointFile(threadId)
    ensureDir(path.dirname(filePath));
    // FileSaver 基于一会话一文件策略把内存中的会话检查点持久化到本地，
    // 单会话隔离、易管理，代价是会话数量多时会产生大量小文件
    const checkpointer = new FileSaver(filePath)

    // ===== 第二块：按配置加载对话模型 =====
    // 先按智能体名称读取该智能体的整体配置，里面记录了它要用哪个模型、基础提示词等
    const agentconfig = readConfigByAgentName(agentName);
    // 智能体不存在时给出明确错误，避免后续取属性抛 "Cannot read properties of null"
    if (!agentconfig) {
        throw new Error(`智能体 "${agentName}" 不存在，请检查配置文件 ~/.makefile_claw/makefile_claw.json`);
    }
    // 从智能体配置中取出模型名称
    const modelName = agentconfig.model;
    // 再按模型名称读取该模型的具体配置，包含接口地址、密钥、参数等
    const modelconfig = readConfigByModelName(modelName);
    // 模型不存在时同样给出明确提示
    if (!modelconfig) {
        throw new Error(`智能体 "${agentName}" 绑定的模型 "${modelName}" 不存在，请检查配置文件 ~/.makefile_claw/makefile_claw.json`);
    }
    // 基于模型配置初始化一个流式输出的模型实例（AgentPool 传入已缓存的 model 时直接复用）
    const model = opts.model ?? await initStreamModel(modelconfig);

    // ===== 第三块：初始化 deepagents 文件+Shell 后端（Agent 基础工具集） =====
    // 工作区根目录固定为 ~/.makefile_claw/workspaces，AI 只能在此目录下操作文件。
    // virtualMode=true 时 deepagents 会把所有路径视为 rootDir 下的虚拟路径，
    // 拒绝绝对路径穿透与 .. 越界，从而把文件工具（read_file/write_file/edit_file/
    // ls/glob/grep/delete）严格限制在工作区范围内。
    // 工作区根目录：单 Agent 固定为 ~/.makefile_claw/workspaces；
    // 团队 Worker 通过 opts.workspaceDir 指向独立子工作区 workspaces/<teamThreadId>/<workerName>/，
    // 实现工作区隔离，避免并行写冲突。
    const workspace = opts.workspaceDir ?? (process.env.MAKEFILE_CLAW_WORKSPACE ?? path.join(os.homedir(), '.makefile_claw', 'workspaces'));
    ensureDir(path.resolve(workspace));
    if (opts.sharedDir) ensureDir(path.resolve(opts.sharedDir));
    const backend = await LocalShellBackend.create({
        rootDir: path.resolve(workspace),
        virtualMode: true,
        // 必须继承进程环境：否则 execute 的 cmd.exe 空环境找不到 PATH，所有命令都会失败
        inheritEnv: true,
        // execute 命令执行超时（秒），对齐原 MCP_SHELL_MAX_EXECUTION_TIME
        timeout: 300,
        // 单次命令输出上限（字节）：过大的输出会完整进入模型上下文，
        // 多轮工具调用后上下文迅速膨胀、单轮推理越来越慢，因此收紧到 20KB，
        // 需要更多内容时让模型用 grep / read_file 精确取片段
        maxOutputBytes: 20_000,
    });

    // ===== 第四块：按开关加载 MCP 工具（叠加到 deepagents 之上） =====
    // 文件 MCP 服务（@modelcontextprotocol/server-filesystem）与 Shell MCP 服务
    // （@mako10k/mcp-shell-server）提供额外的文件/终端能力。
    // createDeepAgent 的 tools 参数只追加工具，不会移除 deepagents 内置的文件系统工具。
    // MCP 工具：AgentPool 传入共享实例时复用（不拉起新子进程），否则按需加载（单 Agent 旧行为不变）
    const loadedMcp = opts.mcpTools ?? await loadMcpTools(toolsEnable, path.resolve(workspace));
    const mcpTools = loadedMcp.tools;
    const closeMcp = loadedMcp.close;

    // ===== 第五块：用模型、工具、提示词、检查点编译出智能体 =====
    // 组装最终 system prompt：
    // 1. 配置文件自带的系统提示词
    // 2. deepagents 内置工具说明（文件操作限制在工作区；Windows 下 execute 用 cmd 语法）
    // 3. MCP 终端工具说明（Windows 下 shell_type 必须为 powershell）
    // 4. 用户选中的技能正文内容（Skills），作为任务规范上下文注入
    let finalSystemPrompt = agentconfig.systemPrompt + `
【文件访问范围】
你的所有文件操作（read_file / write_file / edit_file / ls / glob / grep / delete）均被限制在工作区目录内，
工作区根路径为：${path.resolve(workspace)}
不得尝试访问工作区之外的任何文件或目录。若技能文档引用了工作区外的文件，请改用 execute 工具通过 shell 命令读取。

【deepagents 终端工具说明】
execute 工具在 Windows 下通过 cmd.exe 执行命令，请使用 cmd 语法（如 dir/type/findstr），
不要使用 bash/powershell 专属语法（如 ls/cat/grep/ps 等）。文件查找优先使用内置的 grep/glob 工具，
文件内容读取使用 read_file 工具。命令必须为短任务，不要启动长驻后台服务。

【MCP 终端工具说明】
除内置 execute 外，还可用 MCP 提供的 terminal_create / terminal_operate / terminal_close 管理持久终端会话。
Windows 环境创建 MCP 终端时，shell_type 必须指定为 "powershell"（默认 bash 在 Windows 下不存在）。

【上下文管理（重要）】
你每调用一次工具，完整的工具结果都会被加入对话历史，导致后续每一步推理越来越慢。
为避免任务因上下文过大而被中断，请遵守以下原则：
1. 每执行 8-10 次工具调用后，先用简短文字向用户汇报已完成的工作（列出已创建/修改的文件和关键进展），
   再继续后续步骤。这样可以让用户在必要时决定是否开新会话以重置上下文。
2. 读取文件时，优先用 grep 搜索关键内容，避免用 read_file 读取整个大文件。
3. execute 命令的输出已被截断，若需要更多内容，请用 grep 或分页查看。
4. 对于大型任务，主动分阶段执行，每完成一个阶段就停下来向用户确认。
`;
    if (opts.sharedDir) {
        finalSystemPrompt += `
【团队共享产物目录】
如需把文件交给其他团队成员，请放到共享目录：${path.resolve(opts.sharedDir)}
其他 Worker 可从该目录读取你产出的文件。完成子任务后，请把关键产物放到该目录并在汇报中说明文件名。
`;
    }
    if (skillsContent && skillsContent.trim()) {
        finalSystemPrompt += `
【可用技能 Skills】
以下是当前可用的技能规范文档，请在执行任务时遵循对应技能的流程和约束：

${skillsContent}
`;
    }

    // 使用 deepagents 的 createDeepAgent 编译智能体：
    // - model：对话模型
    // - tools：MCP 额外工具（叠加在内置文件/Shell 工具之上）
    // - systemPrompt：最终系统提示词
    // - middleware：todoListMiddleware 提供 write_todos 工具；createFilesystemMiddleware 提供文件工具
    // - backend：LocalShellBackend 提供 execute 能力
    // - checkpointer：FileSaver 持久化会话状态
    const agent = await createDeepAgent({
        model,
        tools: mcpTools,
        systemPrompt: finalSystemPrompt,
        middleware: [
            todoListMiddleware(),
            createFilesystemMiddleware({ backend }),
        ],
        backend,
        checkpointer,
        name: agentName,
    });

    // close：先关闭 deepagents 后端，再关闭 MCP 终端并强杀子进程树、断开连接
    const close = async () => {
        await backend.close();
        await closeMcp();
    };

    // 对外返回智能体、统一关闭函数、检查点，调用方在 finally 里负责调用 close
    return { agent, close, checkpointer };
}

export {
  SystemMessage,
  HumanMessage,
  AIMessage,
  FileSaver,
};

// 多智能体编排相关导出（路径工具 + 团队共享状态存储）
export * from './paths.js';
export { TeamStateStore } from './orchestrator/team-state-store.js';
export type {
  TeamState,
  TeamMessage,
  TeamArtifact,
  DelegationRecord,
} from './orchestrator/team-state-store.js';

// 资源池：AgentPool（模型复用）+ McpRegistry（MCP 子进程单例复用）
export { AgentPool, agentPool } from './pool/AgentPool.js';
export type { PooledAgent } from './pool/AgentPool.js';
export { McpRegistry, mcpRegistry } from './pool/McpRegistry.js';

// 编排引擎（模式 C 主管动态委派）
export {
  createTeamGraph,
  runTeamStream,
  buildSupervisorPrompt,
  supervisorDecide,
  runWorker,
  extractChunkText,
  parseSupervisorDecision,
  ConcurrencyController,
  Semaphore,
  AsyncQueue,
} from './orchestrator/index.js';
export type {
  TeamConfig,
  TeamStreamEvent,
  TeamStage,
  SupervisorDecision,
  RunTeamOptions,
} from './orchestrator/index.js';
