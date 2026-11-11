import { readConfigByAgentName, readConfigByModelName } from './readConfig.js';
import { initStreamModel } from './agents.js';
import { createModel } from './LLM_instance.js';
import { SystemMessage, HumanMessage, AIMessage } from 'langchain';

export { readConfigByAgentName, readConfigByModelName, initStreamModel, createModel };

import path from 'node:path';
import os from 'node:os';

// @ts-ignore - FileSaver 是纯 JS 模块，暂无类型声明文件
import { FileSaver } from "./FileSaver.js"

// deepagents：内置文件 + shell 工具（LocalShellBackend），取代原 MCP file/shell 子进程
import {
    createDeepAgent,
    createFilesystemMiddleware,
    LocalShellBackend,
} from 'deepagents';
// 待办工具（write_todos），与文件中间件一起显式传入，保持工具集可控
import { todoListMiddleware } from 'langchain';

/**
 * 创建 deepagents 智能体
 * @param agentName 智能体名称
 * @param threadId 会话ID
 * @param toolsEnable 工具开关配置（保留参数位以兼容调用方；deepagents 内置工具随 backend 注册）
 * @param skillsContent 选中技能的正文内容（会追加到 system prompt 末尾，注入给 Agent 作为任务规范上下文）
 */
export async function createMakefileClawAgent(agentName: string, threadId: string, toolsEnable = { fileTools: true, shellTools: true, webTools: true }, skillsContent = ''): Promise<{ agent: any; close: () => Promise<void>; checkpointer: any }> {
    // ===== 第一块：准备会话持久化检查点 =====
    // 取当前用户主目录，作为检查点文件的根路径
    const homePath = os.homedir();
    // 拼接本会话的检查点文件完整路径，一会话对应一个 json 文件，文件名就是 threadId
    const filePath = path.join(homePath, '.makefile_claw', 'memory', threadId + '.json')
    // FileSaver 基于一会话一文件策略把内存中的会话检查点持久化到本地，
    // 单会话隔离、易管理，代价是会话数量多时会产生大量小文件
    const checkpointer = new FileSaver(filePath)

    // ===== 第二块：按配置加载对话模型 =====
    // 先按智能体名称读取该智能体的整体配置，里面记录了它要用哪个模型、基础提示词等
    const agentconfig = readConfigByAgentName(agentName);
    // 从智能体配置中取出模型名称
    const modelName = agentconfig.model;
    // 再按模型名称读取该模型的具体配置，包含接口地址、密钥、参数等
    const modelconfig = readConfigByModelName(modelName);
    // 基于模型配置初始化一个流式输出的模型实例
    const model = await initStreamModel(modelconfig);

    // ===== 第三块：初始化 deepagents 文件+Shell 后端（取代 MCP 子进程） =====
    // rootDir 取项目工作目录；virtualMode=false 时绝对路径可穿透 rootDir，
    // 技能脚本（位于 ~/.makefile_claw/skills/ 下）仍可通过绝对路径访问。
    const workspace = process.env.MAKEFILE_CLAW_WORKSPACE ?? process.cwd();
    const backend = await LocalShellBackend.create({
        rootDir: path.resolve(workspace),
        virtualMode: false,
        // 必须继承进程环境：否则 execute 的 cmd.exe 空环境找不到 PATH，所有命令都会失败
        inheritEnv: true,
        // execute 命令执行超时（秒），对齐原 MCP_SHELL_MAX_EXECUTION_TIME
        timeout: 300,
        // 单次命令输出上限（字节），超长输出截断，防止大结果撑爆上下文
        maxOutputBytes: 100_000,
    });

    // ===== 第四块：用模型、工具、提示词、检查点编译出智能体 =====
    // 组装最终 system prompt：
    // 1. 配置文件自带的系统提示词
    // 2. 终端工具说明（Windows 下 execute 经 cmd.exe 执行，需用 cmd 语法）
    // 3. 用户选中的技能正文内容（Skills），作为任务规范上下文注入
    let finalSystemPrompt = agentconfig.systemPrompt + `
【终端工具说明】
execute 工具在 Windows 下通过 cmd.exe 执行命令，请使用 cmd 语法（如 dir/type/findstr），
不要使用 bash/powershell 专属语法（如 ls/cat/grep/ps 等）。文件查找优先使用内置的 grep/glob 工具，
文件内容读取使用 read_file 工具。命令必须为短任务，不要启动长驻后台服务。
`;
    if (skillsContent && skillsContent.trim()) {
        finalSystemPrompt += `
【可用技能 Skills】
以下是当前可用的技能规范文档，请在执行任务时遵循对应技能的流程和约束：

${skillsContent}
`;
    }

    // 显式传入 middleware（todo + 文件中间件），避免 deepagents 默认中间件集
    // （subagents/task 等）引入额外工具与内置提示词，保持行为可控
    const agent = await createDeepAgent({
        model,
        systemPrompt: finalSystemPrompt,
        middleware: [
            todoListMiddleware(),
            createFilesystemMiddleware({ backend }),
        ],
        backend,
        // 注入检查点，让智能体的每一步状态都能被持久化和恢复
        checkpointer,
        name: agentName,
    });

    // close：deepagents 的 execute 每次都是短命子进程，无进程树需要清理，仅关闭后端
    const close = async () => {
        await backend.close();
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
