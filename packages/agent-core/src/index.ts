import { readConfigByAgentName, readConfigByModelName } from './readConfig.js';
import { initStreamModel } from './agents.js';
import { createModel } from './LLM_instance.js';
import { SystemMessage, HumanMessage, AIMessage, createAgent, tool } from 'langchain';

export { readConfigByAgentName, readConfigByModelName, initStreamModel, createModel };

import path from 'node:path';
import os from 'node:os';

// @ts-ignore - FileSaver 是纯 JS 模块，暂无类型声明文件
import { FileSaver } from "./FileSaver.js"

// 导入MCP SDK的客户端核心类，用于和MCP服务端建立会话、调用工具
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
// 导入标准输入输出传输层，通过子进程stdio管道通信（本地进程间通信方案）
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// 终端托管纯逻辑：注册表、MCP 响应解析、超时包装，均在独立模块，可单独单测
import {
    createTerminalRegistry,
    parseMcpTextResult,
    withTimeout,
    REGISTRY_DEBUG,
} from './terminal-registry.js'


// spawnMcpShell 是你启动shell mcp服务的childProcess
import { spawn } from 'child_process';
import { exec } from 'child_process';

// taskkill 自身的超时时间，防止它异常卡住拖慢整个 close
const KILL_TREE_TIMEOUT_MS = 5_000;

// 关闭 MCP 进程以及它的整棵子进程树。Windows 用 taskkill，其他平台退化为直接 kill。
// 只在 close 阶段调用，运行过程中绝不触发。
async function killMcpTree(cp?: ReturnType<typeof spawn>): Promise<boolean> {
    // 进程对象不存在或没有 pid 时直接返回，不执行任何命令
    const pid = cp?.pid;
    if (!pid) return false;

    if (REGISTRY_DEBUG) {
        console.log(`[KILL PROCESS TREE] pid=${pid}`);
    }

    // 非 Windows 平台，client.close 本身回收较干净，这里补一次 SIGKILL 即可
    if (process.platform !== 'win32') {
        try {
            cp?.kill('SIGKILL');
        } catch {}
        return true;
    }

    // 精简 PATH 下 taskkill 可能不可见，用 SystemRoot 拼出完整路径
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');

    return new Promise(resolve => {
        let settled = false;
        const finish = (val: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(val);
        };
        // 5s 超时保护，到点就放弃，不阻塞后续流程
        const timer = setTimeout(() => finish(false), KILL_TREE_TIMEOUT_MS);
        // /T 递归杀进程树，/F 强制终止，Windows 下必须保留这两个参数
        exec(`"${taskkill}" /T /F /PID ${pid}`, () => finish(true));
    });
}

// 终端注册表、MCP 解析与超时包装已迁移到 ./terminal-registry.js，文件顶部统一导入。


// 根据传入的开关配置 toolsEnable，选择性加载文件 MCP 工具、Shell MCP 工具，收集工具集合，同时返回一个带可选链容错的关闭函数，用来按需关闭已经启动的 MCP 客户端
async function loadMcpTools(toolsEnable: any) {
    const tools = []
    let fileClient: Client
    let shellClient: Client
    // 缓存 Shell 终端统一清理函数，连接断开前必须先执行
    let shellCleanup: (() => Promise<void>) | undefined
    // 只保存两个 MCP 传输层的子进程引用，运行过程中不做任何操作，close 时统一强杀
    let fileChildProcess: ReturnType<typeof spawn> | undefined
    let shellChildProcess: ReturnType<typeof spawn> | undefined

    //  toolsEnable.fileTools 为 true 的时候，加载文件相关工具
    if (toolsEnable.fileTools) {
        // 开启文件工具：执行 loadMcpFileTools，拉起文件 MCP 服务、拿到工具数组和客户端实例，工具放进总工具数组，缓存 client
        const { fileTools, client, childProcess } = await loadMcpFileTools()
        tools.push(...fileTools)
        fileClient = client
        fileChildProcess = childProcess
    }

    //  toolsEnable.shellTools 为 true 的时候，加载 Shell MCP 工具
    if (toolsEnable.shellTools) {
        // 开启 Shell工具：执行 loadMcpShellTools，拉起 Shell MCP 服务、拿到工具数组和客户端实例，工具放进总工具数组，缓存 client 与清理函数
        const { shellTools, client, cleanupTerminals, childProcess } = await loadMcpShellTools()
        tools.push(...shellTools)
        shellClient = client
        shellCleanup = cleanupTerminals
        shellChildProcess = childProcess
    }

    // 返回：合并后的工具列表、一个清理函数，先强制回收残留终端，再关闭已经启动的 MCP 客户端实例
    return {
        tools,
        close: async () => {
            // 第一步：连接还存活时，走 MCP 协议优雅关闭所有注册终端，内部已带 10s 超时和逐个吞错
            try {
                await shellCleanup?.()
            } catch (err) {
                console.warn('[terminal cleanup warning]', err)
            }

            // 第二步：强杀进程树，必须排在 client.close 之前。
            // 实测 client.close 内部会先杀掉根进程，cross-spawn 又只杀直接子进程不递归，
            // 一旦根先死，npx 派生的 cmd、node、pwsh 就被孤儿化，再对已死的根做 taskkill /T 也枚举不到它们。
            // 根还活着时 taskkill /T 能顺着完整进程树递归清理，空值会自动跳过。
            await Promise.allSettled([
                killMcpTree(fileChildProcess),
                killMcpTree(shellChildProcess),
            ]);

            // 第三步：再走标准 MCP 断开流程，此时进程已终止，close 只做传输层状态清理，
            // 不会报错，也不会再制造孤儿。allSettled 保证单个失败也不阻断。
            await Promise.allSettled([
                fileClient?.close(),
                shellClient?.close(),
            ]);
        }
    }
}

// 拉起文件系统 MCP 服务、建立 Stdio 连接，拉取并转换为 LangChain 工具，同时返回工具数组与 MCP 客户端实例，方便外部使用工具以及后续释放子进程资源
async function loadMcpFileTools() {
    let fileTools = []

    // 实例化 MCP客户端，name 和 version用于标识这个客户端，服务端会记录来源信息
    const client = new Client({
        name: 'mcp-file-stdio-client',
        version: '1.0.0'
    })

    // 开启 MCP SDK 底层通信日志，查看客户端和服务端收发的协议报文，用来排查超时这类通信问题
    // process.env.DEBUG = '@modelcontextprotocol/sdk:*'

    // 构造 Stdio传输层实例：通过spawn创建子进程，基于子进程stdin/stdout双向收发MCP JSON‑RPC协议报文
    const transport = new StdioClientTransport({
        command: 'npx',
        args: [
            "-y",
            "@modelcontextprotocol/server-filesystem",
            "D:\\AI项目二\\makefile_claw"
        ],
        env: {
            ...process.env,
            NPM_CONFIG_LOGLEVEL: 'silent',
            NPM_CONFIG_FUND: 'false',
            NODE_NO_WARNINGS: '1'
        },
        stderr: 'pipe'
    })

    // transport.stderr?.on('data', () => {})
    transport.stderr?.on('data', (buf) => {
        console.error('[Shell MCP stderr]', buf.toString())
    })

    // 发起连接：启动子进程、执行 MCP协议握手，完成客户端与服务端的协议初始化
    await client.connect(transport)

    fileTools = await convertMcpToolsToLangChainTools(client)

    // connect 成功后再从 transport 取内部 spawn 子进程，属性名兼容不同 SDK 版本
    const childProcess: ReturnType<typeof spawn> | undefined =
        (transport as any).process ?? (transport as any)._process;
    if (REGISTRY_DEBUG) {
        console.log(`[MCP FILE CHILD] pid=${childProcess?.pid ?? 'none'}`);
    }

    return { fileTools, client, childProcess }
}

// 初始化 Shell MCP客户端，建立 Stdio通信链路、拉取并转换 Shell MCP工具列表，
// 返回工具列表、客户端实例与终端统一清理函数，方便后续释放终端和子进程资源
async function loadMcpShellTools() {

    // 实例化 MCP客户端，name 和 version用于标识这个客户端，服务端会记录来源信息
    const client = new Client({
        name: 'mcp-shell-stdio-client',
        version: '1.0.0'
    })

    // 构造 Stdio传输层实例：通过spawn创建子进程，基于子进程stdin/stdout双向收发MCP JSON‑RPC协议报文
    const transport = new StdioClientTransport({
        command: 'npx',
        args: [
            "-y",
            "@mako10k/mcp-shell-server",
        ],
        env: {
            MCP_SHELL_SECURITY_MODE: "enhanced",
            MCP_SHELL_LLM_API_KEY: process.env.ZHIPU_API_KEY || '',
            MCP_SHELL_LLM_BASE_URL: "https://open.bigmodel.cn/api/paas/v4",
            MCP_SHELL_LLM_TIMEOUT: "30",
            MCP_SHELL_ALLOWED_WORKDIRS: [
                path.resolve(process.cwd()),
                path.resolve('D:\\AI项目二\\makefile_claw'),
                path.resolve('C:\\Users\\49928\\.makefile_claw'),
            ].join(','),        
            MCP_SHELL_ELICITATION: "false",
            MCP_SHELL_MAX_EXECUTION_TIME: "300",
            NPM_CONFIG_LOGLEVEL: 'silent',
            NPM_CONFIG_FUND: 'false',
            NODE_NO_WARNINGS: '1'
        },
        stderr: 'pipe'
    })

    transport.stderr?.on('data', () => {})

    // 发起连接：启动子进程、执行 MCP协议握手，完成客户端与服务端的协议初始化
    await client.connect(transport)

    // 每个 shell 连接独立持有一份终端注册表
    const registry = createTerminalRegistry()

    // 调试观测阶段：每 30s 打印一次注册表 size，cleanup 时通过 stopDebug 关闭
    const stopDebug = registry.startDebugInterval(30_000)

    // 转换工具时传入 afterCall 守卫，每次工具调用返回后由代码层维护注册表
    const shellTools = await convertMcpToolsToLangChainTools(client, async (name: string, input: any, result: any) => {
        if (name === 'terminal_operate') {
            // 复合工具返回里一定带 terminal_id，新建和复用都登记，代码层直接托管
            const obj = parseMcpTextResult(result)
            const tid = obj?.terminal_id ?? input?.terminal_id
            if (tid) registry.track(tid)
        } else if (name === 'terminal_close') {
            // close 调用没有抛错即视为终端已关闭，从注册表移除
            const tid = input?.terminal_id
            if (tid) registry.untrack(tid)
        }
    })

    // 单个终端关闭的超时时间，到点就放弃这一个，继续处理后面的终端
    const CLOSE_TIMEOUT_MS = 10_000

    // 统一清理：遍历注册表残留终端逐个真实关闭，在 MCP 连接断开前执行
    // 无论模型忘记关、任务报错还是超时，外层 finally 都会调用它兜底
    const cleanupTerminals = async () => {
        const ids = registry.ids()
        for (const tid of ids) {
            try {
                // 每个 close 单独套超时，避免一个卡住阻塞后续清理和 MCP 关闭
                await withTimeout(
                    client.callTool({
                        name: 'terminal_close',
                        arguments: { terminal_id: tid },
                    }),
                    CLOSE_TIMEOUT_MS,
                    `terminal_close ${tid}`,
                )
                console.log('[REGISTRY AUTO CLEAN] tid=' + tid)
            } catch (err) {
                console.error('【Graph关闭终端失败】', tid, err)
            }
        }
        registry.clear()
        stopDebug()
        console.log('[REGISTRY AFTER CLEAN] 剩余数量：' + registry.size)
    }

    // connect 成功后再从 transport 取内部 spawn 子进程，属性名兼容不同 SDK 版本
    const childProcess: ReturnType<typeof spawn> | undefined =
        (transport as any).process ?? (transport as any)._process;
    if (REGISTRY_DEBUG) {
        console.log(`[MCP SHELL CHILD] pid=${childProcess?.pid ?? 'none'}`);
    }

    return { shellTools, client, cleanupTerminals, childProcess }
}


// 读取 MCP服务端工具列表，转换为LangGraph可用的工具对象数组
// afterCall 是可选守卫，在每次工具调用返回后触发，用来在代码层托管终端状态
async function convertMcpToolsToLangChainTools(
    client: any,
    afterCall?: (name: string, input: any, result: any) => void | Promise<void>,
) {
    // 获取 MCP 服务器中的工具列表
    const { tools } = await client.listTools()
    // 将 MCP工具列表转换为 LangChain 格式
    return tools.filter((item: any) => item.name !== 'shell_execute').map(
        (item: any) => tool(
            async (input: any) => {
                const result = await client.callTool({
                    name: item.name,
                    arguments: input ?? {},
                })
                console.log('工具调用结果---------------------')
                console.log(result)

                // 结果返回给模型前先执行守卫，确保注册表状态先于模型更新
                await afterCall?.(item.name, input ?? {}, result)

                // 原生 MCP对象
                return result
            },
            {
                name: item.name,
                description: item.description,
                schema: item.inputSchema
            }
        )
    )
}

/**
 * 创建 LangChain 智能体
 * @param agentName 智能体名称
 * @param threadId 会话ID
 * @param toolsEnable 工具开关配置
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

    // ===== 第三块：按开关加载 MCP 工具，同时拿到统一关闭函数 =====
    // 内部会拉起文件 MCP 和 shell MCP 两个子进程，转换为 LangChain 工具，
    // 并返回 close，close 内部按优雅关终端、强杀进程树、断开连接三步执行
    const { tools, close } = await loadMcpTools(toolsEnable)

    // ===== 第四块：用模型、工具、提示词、检查点编译出智能体 =====
    // 组装最终 system prompt：
    // 1. 配置文件自带的系统提示词
    // 2. 终端工具说明（Windows 下 shell_type 必须指定 powershell）
    // 3. 用户选中的技能正文内容（Skills），作为任务规范上下文注入
    let finalSystemPrompt = agentconfig.systemPrompt + `
【终端工具说明】
Windows 环境创建终端时，shell_type 必须指定为 "powershell"。该参数默认值是 bash，而 Windows 下 bash 路径不存在，用默认值会直接导致终端创建失败。
`;
    if (skillsContent && skillsContent.trim()) {
        finalSystemPrompt += `
【可用技能 Skills】
以下是当前可用的技能规范文档，请在执行任务时遵循对应技能的流程和约束：

${skillsContent}
`;
    }

    const agent = createAgent({
        model,
        tools,
        systemPrompt: finalSystemPrompt,
        // 注入检查点，让智能体的每一步状态都能被持久化和恢复
        checkpointer,
    });

    // 对外返回智能体、统一关闭函数、检查点，调用方在 finally 里负责调用 close
    return { agent, close, checkpointer };
}

export { 
  SystemMessage,
  HumanMessage,
  AIMessage,
  FileSaver,
 };

