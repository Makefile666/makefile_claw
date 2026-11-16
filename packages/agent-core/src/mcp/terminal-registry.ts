// 终端注册表与 MCP 响应解析的纯逻辑模块。
// 不依赖 langchain，只依赖 node 能力，方便被 index.ts 引用，也方便单独写单元测试。

// 调试观测总开关。灰度期间保持 true，上线前改成 false，即可关闭周期 size 日志。
export const REGISTRY_DEBUG = true;

// 单个终端的托管记录，createdAt 记录首次创建，lastActivity 每次操作刷新。
export type TerminalRecord = {
    terminalId: string;
    createdAt: number;
    lastActivity: number;
};

// 给任意 Promise 加一道超时墙。
// 超时后直接 reject，避免某一个终端关闭卡住，拖垮后面的终端清理和 MCP 连接关闭。
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`${label} 超过 ${ms}ms 未完成`));
        }, ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

// 创建终端注册表。所有状态都在代码层维护，不经过模型，模型不需要记住任何 terminal_id。
export function createTerminalRegistry() {
    const terminals = new Map<string, TerminalRecord>();

    return {
        // 登记一个终端，已存在则只刷新活跃时间，保留首次创建时间。
        track(terminalId: string) {
            const now = Date.now();
            const exist = terminals.get(terminalId);
            terminals.set(terminalId, {
                terminalId,
                createdAt: exist?.createdAt ?? now,
                lastActivity: now,
            });
            console.log(`[REGISTRY TRACK] tid=${terminalId}，当前总数：${terminals.size}`);
        },
        // 移除一个终端，正常关闭后调用。
        untrack(terminalId: string) {
            terminals.delete(terminalId);
            console.log(`[REGISTRY UNTRACK] tid=${terminalId}，当前总数：${terminals.size}`);
        },
        // 拿到当前所有残留终端 ID。
        ids() {
            return Array.from(terminals.keys());
        },
        clear() {
            terminals.clear();
        },
        get size() {
            return terminals.size;
        },
        // 可选的周期观测，返回停止函数。只在调试开关打开时真正启动。
        startDebugInterval(intervalMs = 30_000): () => void {
            if (!REGISTRY_DEBUG) return () => {};
            const timer = setInterval(() => {
                console.log(`[REGISTRY SIZE] 当前总数：${terminals.size}`);
            }, intervalMs);
            // unref 让这个定时器不阻塞进程自然退出。
            timer.unref?.();
            return () => clearInterval(timer);
        },
    };
}

// 解析 MCP content[0].text 里的 JSON。
// 任何异常都兜底打印原始内容，方便排查 MCP 返回结构异常的情况。
export function parseMcpTextResult(result: any): any {
    const text = result?.content?.[0]?.text;
    if (typeof text !== 'string' || text.length === 0) {
        console.warn('[MCP PARSE] 响应缺少 text 字段，原始响应：', result);
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch (err) {
        console.warn('[MCP PARSE] JSON 解析失败，原始文本：', text);
        return undefined;
    }
}
