import { createAgent } from './index';
import { readConfigByAgentName } from './readConfig';

// mock node:fs，避免测试依赖真实文件系统
jest.mock('node:fs', () => ({
  readFileSync: jest.fn(() => JSON.stringify({
    agents: [
      { name: 'ds-pro', model: 'ds', systemPrompt: 'test' },
    ],
  })),
}));

describe('readConfigByAgentName', () => {
  it('当 agentName 为空字符串时抛出异常', () => {
    expect(() => readConfigByAgentName('')).toThrow('智能体不存在');
  });

  it('当 agentName 为 undefined 时抛出异常', () => {
    expect(() => readConfigByAgentName(undefined as unknown as string)).toThrow('智能体不存在');
  });

  it('当 agentName 为 null 时抛出异常', () => {
    expect(() => readConfigByAgentName(null as unknown as string)).toThrow('智能体不存在');
  });

  it('当 agentName 有效时返回对应智能体配置', () => {
    const result = readConfigByAgentName('ds-pro');
    expect(result).not.toBeNull();
    expect(result?.name).toBe('ds-pro');
  });

  it('当 agentName 不存在时返回 null', () => {
    expect(readConfigByAgentName('not-exist')).toBeNull();
  });
});

describe('createAgent', () => {
  it('当 agentName 为空时拒绝', async () => {
    await expect(createAgent('')).rejects.toThrow('智能体不存在');
  });

  it('当 agentName 不存在时拒绝', async () => {
    await expect(createAgent('not-exist')).rejects.toThrow('智能体不存在');
  });
});
