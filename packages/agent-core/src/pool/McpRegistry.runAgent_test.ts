import { McpRegistry } from './McpRegistry';

// 用 mock 替代真实 MCP 加载器，避免在测试中拉起 npx 子进程
const mockFile = jest
  .fn()
  .mockResolvedValue({ fileTools: [{ name: 'file_tool' }], client: { close: jest.fn() }, childProcess: { pid: 111 } });
const mockShell = jest.fn().mockResolvedValue({
  shellTools: [{ name: 'shell_tool' }],
  client: { close: jest.fn() },
  cleanupTerminals: jest.fn().mockResolvedValue(undefined),
  childProcess: { pid: 222 },
});
const mockPuppeteer = jest
  .fn()
  .mockResolvedValue({ puppeteerTools: [{ name: 'puppeteer_tool' }], client: { close: jest.fn() }, childProcess: { pid: 333 } });
const mockRemote = jest.fn().mockResolvedValue({ remoteTools: [{ name: 'remote_tool' }], client: { close: jest.fn() } });
const mockKill = jest.fn().mockResolvedValue(true);

jest.mock('../mcp/index.js', () => ({
  loadMcpFileTools: (...args: any[]) => mockFile(...args),
  loadMcpShellTools: (...args: any[]) => mockShell(...args),
  loadMcpPuppeteerTools: (...args: any[]) => mockPuppeteer(...args),
  loadRemoteMcpTools: (...args: any[]) => mockRemote(...args),
  resolveRemoteServers: (te: any) => te?.remoteServers ?? [],
  killMcpTree: (...args: any[]) => mockKill(...args),
}));

describe('McpRegistry（MCP 子进程单例复用）', () => {
  let reg: McpRegistry;
  beforeEach(() => {
    reg = new McpRegistry();
    jest.clearAllMocks();
  });

  it('TR-5.1 同类 MCP 多次 acquire 只创建一次，返回同一 tools 引用', async () => {
    const a = await reg.acquire({ fileTools: true });
    const b = await reg.acquire({ fileTools: true });
    expect(mockFile).toHaveBeenCalledTimes(1);
    // 两次 acquire 返回的工具元素是同一对象引用（底层 MCP 客户端/子进程被复用）
    expect(a.tools[0]).toBe(b.tools[0]);
    expect(reg.instanceCount()).toBe(1);
  });

  it('TR-5.2 release 递减引用计数但不杀子进程（保持单例复用）', async () => {
    const a = await reg.acquire({ fileTools: true });
    await reg.acquire({ fileTools: true });
    expect(reg.activeRefCount()).toBe(2);
    await a.close();
    expect(reg.activeRefCount()).toBe(1);
    expect(mockKill).not.toHaveBeenCalled();
  });

  it('TR-5.3 file/shell/puppeteer 各自独立单例，closeAll 统一回收', async () => {
    await reg.acquire({ fileTools: true, shellTools: true, puppeteerTools: true });
    expect(mockFile).toHaveBeenCalledTimes(1);
    expect(mockShell).toHaveBeenCalledTimes(1);
    expect(mockPuppeteer).toHaveBeenCalledTimes(1);
    expect(reg.instanceCount()).toBe(3);
    await reg.closeAll();
    expect(mockKill).toHaveBeenCalledTimes(3);
    expect(reg.instanceCount()).toBe(0);
  });

  it('TR-5.4 远程 MCP 按 url 缓存复用', async () => {
    const servers = [{ name: 'gh', url: 'http://x/mcp' }];
    await reg.acquire({ remoteServers: servers } as any);
    await reg.acquire({ remoteServers: servers } as any);
    expect(mockRemote).toHaveBeenCalledTimes(1);
    expect(reg.instanceCount()).toBe(1);
  });

  it('TR-5.5 并发首次 acquire 只创建一次（并发去重，防孤儿进程泄漏）', async () => {
    // 延迟 resolve，确保两次并发 acquire 都进入「未初始化」窗口，复现竞态
    mockFile.mockImplementationOnce(
      () =>
        new Promise((res) =>
          setTimeout(
            () => res({ fileTools: [{ name: 'file_tool' }], client: { close: jest.fn() }, childProcess: { pid: 1 } }),
            10,
          ),
        ),
    );
    const [a, b] = await Promise.all([
      reg.acquire({ fileTools: true }),
      reg.acquire({ fileTools: true }),
    ]);
    // 竞态修复：两次并发首次获取只应拉起一次 MCP 子进程
    expect(mockFile).toHaveBeenCalledTimes(1);
    expect(a.tools[0]).toBe(b.tools[0]);
    expect(reg.instanceCount()).toBe(1);
    expect(reg.activeRefCount()).toBe(2);
  });
});
