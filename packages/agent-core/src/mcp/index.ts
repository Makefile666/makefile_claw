// MCP 工具集成模块
// 基于 @modelcontextprotocol/sdk 客户端，通过 Stdio 传输层拉起文件 MCP 与 Shell MCP 服务，
// 将 MCP 工具列表转换为 LangChain 工具，供 createAgent 使用。

import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

// 导入 MCP SDK 的客户端核心类，用于和 MCP 服务端建立会话、调用工具
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
// 导入标准输入输出传输层，通过子进程 stdio 管道通信（本地进程间通信方案）
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// 导入 Streamable HTTP 传输层，用于连接远程 MCP 服务器（如 GitHub 等公网 MCP 服务）
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// LangChain 的 tool 工厂：把 MCP 工具包装成 LangChain 可识别的工具对象
import { tool } from 'langchain';

// 终端注册表、MCP 响应解析与超时包装
import {
    createTerminalRegistry,
    parseMcpTextResult,
    withTimeout,
    REGISTRY_DEBUG,
} from './terminal-registry.js';

// taskkill 自身的超时时间，防止它异常卡住拖慢整个 close
const KILL_TREE_TIMEOUT_MS = 5_000;

/**
 * 关闭 MCP 进程以及它的整棵子进程树。Windows 用 taskkill，其他平台退化为直接 kill。
 * 只在 close 阶段调用，运行过程中绝不触发。
 */
async function killMcpTree(cp?: ChildProcess): Promise<boolean> {
    const pid = cp?.pid;
    if (!pid) return false;

    if (REGISTRY_DEBUG) {
        console.log(`[KILL PROCESS TREE] pid=${pid}`);
    }

    // 非 Windows 平台，client.close 本身回收较干净，这里补一次 SIGKILL 即可
    if (process.platform !== 'win32') {
        try {
            cp?.kill('SIGKILL');
        } catch {
            /* ignore */
        }
        return true;
    }

    // 精简 PATH 下 taskkill 可能不可见，用 SystemRoot 拼出完整路径
    const taskkill = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');

    return new Promise<boolean>((resolve) => {
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

/**
 * 读取 MCP 服务端工具列表，转换为 LangChain 可用的工具对象数组。
 * afterCall 是可选守卫，在每次工具调用返回后触发，用来在代码层托管终端状态。
 * excludeNames 是需要排除的工具名列表（用于避免与 deepagents 内置工具重名冲突）。
 */
async function convertMcpToolsToLangChainTools(
    client: Client,
    afterCall?: (name: string, input: any, result: any) => void | Promise<void>,
    excludeNames: string[] = [],
) {
    // 获取 MCP 服务器中的工具列表
    const { tools } = await client.listTools();
    // 将 MCP 工具列表转换为 LangChain 格式：
    // - 过滤掉 shell_execute（由 terminal_* 系列工具替代）
    // - 过滤掉与 deepagents 内置文件系统工具重名的工具（read_file/write_file/edit_file/ls/glob/grep/delete/execute），
    //   避免 createDeepAgent 抛出 "Tool name(s) conflict with built-in tools" 错误。
    //   deepagents 内置工具已通过 virtualMode 限制在工作区内，功能等价且更安全。
    const excludeSet = new Set(['shell_execute', ...excludeNames]);
    return tools
        .filter((item: any) => !excludeSet.has(item.name))
        .map((item: any) =>
            tool(
                async (input: any) => {
                    const result = await client.callTool({
                        name: item.name,
                        arguments: input ?? {},
                    });

                    // 结果返回给模型前先执行守卫，确保注册表状态先于模型更新
                    await afterCall?.(item.name, input ?? {}, result);

                    // 原生 MCP 对象
                    return result;
                },
                {
                    name: item.name,
                    description: item.description,
                    schema: item.inputSchema,
                },
            ),
        );
}

/**
 * 拉起文件系统 MCP 服务、建立 Stdio 连接，拉取并转换为 LangChain 工具。
 * 同时返回工具数组与 MCP 客户端实例，方便外部使用工具以及后续释放子进程资源。
 */
async function loadMcpFileTools(workspace: string) {
    // 实例化 MCP 客户端，name 和 version 用于标识这个客户端，服务端会记录来源信息
    const client = new Client({
        name: 'mcp-file-stdio-client',
        version: '1.0.0',
    });

    // 构造 Stdio 传输层实例：通过 spawn 创建子进程，基于子进程 stdin/stdout 双向收发 MCP JSON-RPC 协议报文
    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', workspace],
        env: {
            ...process.env,
            NPM_CONFIG_LOGLEVEL: 'silent',
            NPM_CONFIG_FUND: 'false',
            NODE_NO_WARNINGS: '1',
        },
        stderr: 'pipe',
    });

    transport.stderr?.on('data', (buf) => {
        console.error('[File MCP stderr]', buf.toString());
    });

    // 发起连接：启动子进程、执行 MCP 协议握手，完成客户端与服务端的协议初始化
    await client.connect(transport);

    // deepagents 内置文件系统中间件（createFilesystemMiddleware）已提供以下工具，
    // 且通过 virtualMode 严格限制在工作区内，需排除 File MCP 中的同名工具避免冲突。
    const DEEPAGENTS_BUILTIN_FS_TOOLS = [
        'ls', 'read_file', 'write_file', 'edit_file', 'delete', 'glob', 'grep', 'execute',
    ];
    const fileTools = await convertMcpToolsToLangChainTools(client, undefined, DEEPAGENTS_BUILTIN_FS_TOOLS);

    // connect 成功后再从 transport 取内部 spawn 子进程，属性名兼容不同 SDK 版本
    const childProcess: ChildProcess | undefined =
        (transport as any).process ?? (transport as any)._process;
    if (REGISTRY_DEBUG) {
        console.log(`[MCP FILE CHILD] pid=${childProcess?.pid ?? 'none'}`);
    }

    return { fileTools, client, childProcess };
}

/**
 * 初始化 Shell MCP 客户端，建立 Stdio 通信链路、拉取并转换 Shell MCP 工具列表。
 * 返回工具列表、客户端实例与终端统一清理函数，方便后续释放终端和子进程资源。
 */
async function loadMcpShellTools() {
    // 实例化 MCP 客户端
    const client = new Client({
        name: 'mcp-shell-stdio-client',
        version: '1.0.0',
    });

    // 构造 Stdio 传输层实例
    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@mako10k/mcp-shell-server'],
        env: {
            MCP_SHELL_SECURITY_MODE: 'enhanced',
            MCP_SHELL_LLM_API_KEY: process.env.ZHIPU_API_KEY || '',
            MCP_SHELL_LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
            MCP_SHELL_LLM_TIMEOUT: '30',
            MCP_SHELL_ALLOWED_WORKDIRS: [
                path.resolve(process.cwd()),
                path.resolve(process.env.MAKEFILE_CLAW_WORKSPACE ?? path.join(os.homedir(), '.makefile_claw', 'workspaces')),
            ].join(','),
            MCP_SHELL_ELICITATION: 'false',
            MCP_SHELL_MAX_EXECUTION_TIME: '300',
            NPM_CONFIG_LOGLEVEL: 'silent',
            NPM_CONFIG_FUND: 'false',
            NODE_NO_WARNINGS: '1',
            ...process.env,
        },
        stderr: 'pipe',
    });

    // Shell MCP 服务器的 stderr 可能包含启动错误（如路径不存在、原生模块加载失败等），
    // 之前被完全吞掉导致 "Connection closed" 难以排查。这里打印到 stderr 便于诊断。
    transport.stderr?.on('data', (buf) => {
        console.error('[Shell MCP stderr]', buf.toString());
    });

    // 发起连接
    await client.connect(transport);

    // 每个 shell 连接独立持有一份终端注册表
    const registry = createTerminalRegistry();

    // 调试观测阶段：每 30s 打印一次注册表 size，cleanup 时通过 stopDebug 关闭
    const stopDebug = registry.startDebugInterval(30_000);

    // 转换工具时传入 afterCall 守卫，每次工具调用返回后由代码层维护注册表
    const shellTools = await convertMcpToolsToLangChainTools(
        client,
        async (name: string, input: any, result: any) => {
            if (name === 'terminal_operate') {
                // 复合工具返回里一定带 terminal_id，新建和复用都登记，代码层直接托管
                const obj = parseMcpTextResult(result);
                const tid = obj?.terminal_id ?? input?.terminal_id;
                if (tid) registry.track(tid);
            } else if (name === 'terminal_close') {
                // close 调用没有抛错即视为终端已关闭，从注册表移除
                const tid = input?.terminal_id;
                if (tid) registry.untrack(tid);
            }
        },
    );

    // 单个终端关闭的超时时间，到点就放弃这一个，继续处理后面的终端
    const CLOSE_TIMEOUT_MS = 10_000;

    // 统一清理：遍历注册表残留终端逐个真实关闭，在 MCP 连接断开前执行
    const cleanupTerminals = async () => {
        const ids = registry.ids();
        for (const tid of ids) {
            try {
                await withTimeout(
                    client.callTool({
                        name: 'terminal_close',
                        arguments: { terminal_id: tid },
                    }),
                    CLOSE_TIMEOUT_MS,
                    `terminal_close ${tid}`,
                );
                console.log('[REGISTRY AUTO CLEAN] tid=' + tid);
            } catch (err) {
                console.error('[Graph 关闭终端失败]', tid, err);
            }
        }
        registry.clear();
        stopDebug();
        console.log('[REGISTRY AFTER CLEAN] 剩余数量：' + registry.size);
    };

    // connect 成功后再从 transport 取内部 spawn 子进程
    const childProcess: ChildProcess | undefined =
        (transport as any).process ?? (transport as any)._process;
    if (REGISTRY_DEBUG) {
        console.log(`[MCP SHELL CHILD] pid=${childProcess?.pid ?? 'none'}`);
    }

    return { shellTools, client, cleanupTerminals, childProcess };
}

/**
 * 探测系统已安装的 Chrome/Chromium 可执行文件路径。
 * 优先级：环境变量 PUPPETEER_EXECUTABLE_PATH / CHROME_PATH > 常见安装位置自动探测。
 * Puppeteer 读取 PUPPETEER_EXECUTABLE_PATH 后会直接使用该浏览器，无需再下载 Chromium。
 */
function detectChromeExecutable(): string | undefined {
    // 1. 显式环境变量优先
    const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

    const candidates: string[] = [];
    if (process.platform === 'win32') {
        candidates.push(
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        );
    } else if (process.platform === 'darwin') {
        candidates.push(
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Chromium.app/Contents/MacOS/Chromium',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        );
    } else {
        candidates.push(
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
            '/snap/bin/chromium',
        );
    }

    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return undefined;
}

/**
 * 拉起 Puppeteer MCP 服务、建立 Stdio 连接，拉取并转换为 LangChain 工具。
 * 提供浏览器自动化能力（导航、截图、点击、填写表单、执行 JS 等），
 * 让 Agent 能在真实浏览器中运行/验证前端代码。
 * 工具名均以 puppeteer_ 为前缀，与 deepagents 内置工具无冲突。
 * 优先使用系统已安装的 Chrome（通过 PUPPETEER_EXECUTABLE_PATH），避免重复下载 Chromium。
 */
async function loadMcpPuppeteerTools() {
    const client = new Client({
        name: 'mcp-puppeteer-stdio-client',
        version: '1.0.0',
    });

    // 探测系统 Chrome，传给 Puppeteer 避免下载 Chromium
    const chromePath = detectChromeExecutable();
    if (chromePath) {
        console.log(`[Puppeteer MCP] 使用系统浏览器: ${chromePath}`);
    } else {
        console.warn('[Puppeteer MCP] 未找到系统 Chrome/Edge，将尝试使用 Puppeteer 内置 Chromium（可能需要下载）');
    }

    const transport = new StdioClientTransport({
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-puppeteer'],
        env: {
            ...process.env,
            ...(chromePath ? { PUPPETEER_EXECUTABLE_PATH: chromePath } : {}),
            NPM_CONFIG_LOGLEVEL: 'silent',
            NPM_CONFIG_FUND: 'false',
            NODE_NO_WARNINGS: '1',
        },
        stderr: 'pipe',
    });

    transport.stderr?.on('data', (buf) => {
        console.error('[Puppeteer MCP stderr]', buf.toString());
    });

    await client.connect(transport);

    const puppeteerTools = await convertMcpToolsToLangChainTools(client);

    const childProcess: ChildProcess | undefined =
        (transport as any).process ?? (transport as any)._process;
    if (REGISTRY_DEBUG) {
        console.log(`[MCP PUPPETEER CHILD] pid=${childProcess?.pid ?? 'none'}`);
    }

    return { puppeteerTools, client, childProcess };
}

export interface RemoteMcpServer {
    /** 服务器名称，仅用于日志区分 */
    name: string;
    /** 远程 MCP 服务器的 Streamable HTTP 端点 URL */
    url: string;
    /** 自定义 HTTP 请求头，例如 GitHub MCP 需要 `Authorization: Bearer <token>` */
    headers?: Record<string, string>;
}

export interface ToolsEnable {
    fileTools?: boolean;
    shellTools?: boolean;
    /** 浏览器自动化工具（Puppeteer MCP），用于在真实浏览器中运行/验证前端代码 */
    puppeteerTools?: boolean;
    webTools?: boolean;
    /** 远程 MCP 服务器列表（通过 Streamable HTTP 连接，如 GitHub MCP） */
    remoteServers?: RemoteMcpServer[];
}

export interface LoadedMcpTools {
    tools: any[];
    close: () => Promise<void>;
}

/**
 * 连接远程 MCP 服务器（Streamable HTTP 传输），拉取并转换为 LangChain 工具。
 * 适用于公网 MCP 服务，例如 GitHub MCP（https://api.githubcopilot.com/mcp）。
 * 鉴权通过 headers 传入 Bearer Token。
 */
async function loadRemoteMcpTools(server: RemoteMcpServer) {
    const client = new Client({
        name: `mcp-remote-${server.name}`,
        version: '1.0.0',
    });

    // StreamableHTTPClientTransport 要求传入 URL 对象
    const transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: {
            headers: server.headers ?? {},
        },
    });

    transport.onerror = (err) => {
        console.error(`[Remote MCP ${server.name} error]`, err);
    };

    // 建立 HTTP 连接并完成 MCP 握手
    await client.connect(transport);

    const remoteTools = await convertMcpToolsToLangChainTools(client);
    if (REGISTRY_DEBUG) {
        console.log(`[MCP REMOTE ${server.name}] 加载 ${remoteTools.length} 个工具`);
    }

    return { remoteTools, client };
}

/**
 * 从环境变量中解析远程 MCP 服务器配置，与 toolsEnable.remoteServers 合并。
 * 支持的环境变量：
 *   GITHUB_TOKEN / GH_TOKEN  → 自动连接 GitHub MCP（https://api.githubcopilot.com/mcp）
 *   MCP_REMOTE_SERVERS       → JSON 数组，格式同 RemoteMcpServer[]，用于自定义远程服务器
 */
function resolveRemoteServers(toolsEnable: ToolsEnable): RemoteMcpServer[] {
    const servers: RemoteMcpServer[] = [...(toolsEnable.remoteServers ?? [])];

    // GitHub MCP：检测到 token 时自动加入
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (githubToken && !servers.some((s) => s.name === 'github')) {
        servers.push({
            name: 'github',
            url: 'https://api.githubcopilot.com/mcp',
            headers: {
                Authorization: `Bearer ${githubToken}`,
            },
        });
    }

    // 自定义远程服务器：JSON 数组
    if (process.env.MCP_REMOTE_SERVERS) {
        try {
            const parsed = JSON.parse(process.env.MCP_REMOTE_SERVERS);
            if (Array.isArray(parsed)) {
                for (const s of parsed) {
                    if (s && typeof s.url === 'string') {
                        servers.push({
                            name: s.name ?? `remote-${servers.length}`,
                            url: s.url,
                            headers: s.headers ?? {},
                        });
                    }
                }
            }
        } catch (err) {
            console.warn('[MCP_REMOTE_SERVERS 解析失败]', err);
        }
    }

    return servers;
}

/**
 * 根据传入的开关配置 toolsEnable，选择性加载文件 MCP 工具、Shell MCP 工具、
 * 远程 MCP 服务器工具，收集工具集合，同时返回一个带可选链容错的关闭函数，
 * 用来按需关闭已经启动的 MCP 客户端。
 */
export async function loadMcpTools(
    toolsEnable: ToolsEnable,
    workspace: string,
): Promise<LoadedMcpTools> {
    const tools: any[] = [];
    let fileClient: Client | undefined;
    let shellClient: Client | undefined;
    let puppeteerClient: Client | undefined;
    // 缓存 Shell 终端统一清理函数，连接断开前必须先执行
    let shellCleanup: (() => Promise<void>) | undefined;
    // 保存本地 MCP 传输层的子进程引用，运行过程中不做任何操作，close 时统一强杀
    let fileChildProcess: ChildProcess | undefined;
    let shellChildProcess: ChildProcess | undefined;
    let puppeteerChildProcess: ChildProcess | undefined;
    // 远程 MCP 客户端列表（Streamable HTTP，无本地子进程）
    const remoteClients: Client[] = [];

    if (toolsEnable.fileTools) {
        try {
            const { fileTools, client, childProcess } = await loadMcpFileTools(workspace);
            tools.push(...fileTools);
            fileClient = client;
            fileChildProcess = childProcess;
        } catch (err) {
            // 文件 MCP 加载失败不应阻断 Agent 创建，记录后继续（Agent 仍有 deepagents 内置文件工具可用）
            console.error('[File MCP 加载失败]', err);
        }
    }

    if (toolsEnable.shellTools) {
        try {
            const { shellTools, client, cleanupTerminals, childProcess } = await loadMcpShellTools();
            tools.push(...shellTools);
            shellClient = client;
            shellCleanup = cleanupTerminals;
            shellChildProcess = childProcess;
        } catch (err) {
            // Shell MCP 加载失败不应阻断 Agent 创建，记录后继续（Agent 仍有 deepagents 内置 execute 工具可用）
            console.error('[Shell MCP 加载失败]', err);
        }
    }

    if (toolsEnable.puppeteerTools) {
        try {
            const { puppeteerTools, client, childProcess } = await loadMcpPuppeteerTools();
            tools.push(...puppeteerTools);
            puppeteerClient = client;
            puppeteerChildProcess = childProcess;
        } catch (err) {
            // Puppeteer MCP 加载失败不应阻断 Agent 创建，记录后继续（可能是 Chromium 未安装/网络问题）
            console.error('[Puppeteer MCP 加载失败]', err);
        }
    }

    // 加载远程 MCP 服务器（Streamable HTTP），如 GitHub MCP 等。
    // 服务器来源：toolsEnable.remoteServers + 环境变量（GITHUB_TOKEN / MCP_REMOTE_SERVERS）
    const remoteServers = resolveRemoteServers(toolsEnable);
    for (const server of remoteServers) {
        try {
            const { remoteTools, client } = await loadRemoteMcpTools(server);
            tools.push(...remoteTools);
            remoteClients.push(client);
        } catch (err) {
            // 单个远程服务器连接失败不影响其他工具，记录错误后继续
            console.error(`[Remote MCP ${server.name} 连接失败]`, err);
        }
    }

    return {
        tools,
        close: async () => {
            // 第一步：连接还存活时，走 MCP 协议优雅关闭所有注册终端，内部已带 10s 超时和逐个吞错
            try {
                await shellCleanup?.();
            } catch (err) {
                console.warn('[terminal cleanup warning]', err);
            }

            // 第二步：强杀本地子进程树，必须排在 client.close 之前。
            await Promise.allSettled([
                killMcpTree(fileChildProcess),
                killMcpTree(shellChildProcess),
                killMcpTree(puppeteerChildProcess),
            ]);

            // 第三步：关闭所有 MCP 客户端连接（本地 stdio + 远程 HTTP）
            await Promise.allSettled([
                fileClient?.close(),
                shellClient?.close(),
                puppeteerClient?.close(),
                ...remoteClients.map((c) => c.close()),
            ]);
        },
    };
}
