// 用 MCP SDK 直接测试 Shell MCP 连接，复现 Connection closed
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';
import os from 'node:os';

const workspace = path.join(os.homedir(), '.makefile_claw', 'workspaces');

const env = {
  MCP_SHELL_SECURITY_MODE: 'enhanced',
  MCP_SHELL_LLM_API_KEY: process.env.ZHIPU_API_KEY || '',
  MCP_SHELL_LLM_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
  MCP_SHELL_LLM_TIMEOUT: '30',
  MCP_SHELL_ALLOWED_WORKDIRS: [
    path.resolve(process.cwd()),
    path.resolve(workspace),
  ].join(','),
  MCP_SHELL_ELICITATION: 'false',
  MCP_SHELL_MAX_EXECUTION_TIME: '300',
  NPM_CONFIG_LOGLEVEL: 'silent',
  NPM_CONFIG_FUND: 'false',
  NODE_NO_WARNINGS: '1',
  ...process.env,
};

const client = new Client({ name: 'test', version: '1.0' });
const transport = new StdioClientTransport({
  command: 'npx',
  args: ['-y', '@mako10k/mcp-shell-server'],
  env,
  stderr: 'pipe',
});

transport.stderr?.on('data', (buf) => {
  process.stderr.write('[SHELL STDERR] ' + buf.toString());
});

const timeout = setTimeout(() => {
  console.log('\n[TIMEOUT] 20s 超时，强制关闭');
  client.close().finally(() => process.exit(1));
}, 20000);

try {
  console.log('[TEST] 开始 connect...');
  const t0 = Date.now();
  await client.connect(transport);
  console.log(`[TEST] connect 成功，耗时 ${Date.now() - t0}ms`);

  const { tools } = await client.listTools();
  console.log(`[TEST] listTools 成功，共 ${tools.length} 个工具`);
  console.log('[TEST] 工具列表:', tools.map(t => t.name).join(', '));

  clearTimeout(timeout);
  await client.close();
  console.log('[TEST] 完成');
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.error('[TEST] 失败:', err.message);
  console.error(err.stack);
  try { await client.close(); } catch {}
  process.exit(1);
}
