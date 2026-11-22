import { Test } from '@nestjs/testing';
import { readFileSync } from 'node:fs';
import { ClawConfigService } from './claw-config.service.js';
import { BUILTIN_TOOLS } from './claw-config.types.js';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
}));

describe('ClawConfigService (migration)', () => {
  let service: ClawConfigService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [ClawConfigService],
    }).compile();
    service = module.get(ClawConfigService);
    vi.clearAllMocks();
  });

  it('migrates old agent fields: modelId -> model, tools {id}[] -> string[], active default 1', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agents: [
          {
            name: '旧数据',
            description: '旧描述',
            modelId: 'old-model-id',
            systemPrompt: 'old prompt',
            tools: [
              { id: 'web_search', config: { engine: 'google' } },
              { id: 'shell_command' },
            ],
          },
        ],
        models: [],
        tools: [],
      }),
    );

    const config = service.readConfig();
    const agent = config.agents[0];

    expect(agent.model).toBe('old-model-id');
    expect((agent as any).modelId).toBeUndefined();
    expect(agent.tools).toEqual(['web_search', 'shell_command']);
    expect(agent.active).toBe(1);
    expect(agent.name).toBe('旧数据');
    expect(agent.description).toBe('旧描述');
    expect(agent.systemPrompt).toBe('old prompt');
  });

  it('keeps new-format agents unchanged', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agents: [
          {
            name: '新数据',
            description: '新描述',
            model: 'qwen3.6-plus',
            systemPrompt: 'new prompt',
            tools: ['web_search', 'code_executor'],
            active: 0,
          },
        ],
        models: [],
        tools: [],
      }),
    );

    const agent = service.readConfig().agents[0];
    expect(agent.model).toBe('qwen3.6-plus');
    expect(agent.tools).toEqual(['web_search', 'code_executor']);
    expect(agent.active).toBe(0);
  });

  it('merges builtin tools that are missing from file', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ agents: [], models: [], tools: [] }),
    );
    const config = service.readConfig();
    expect(config.tools.length).toBe(BUILTIN_TOOLS.length);
    expect(config.tools.map((t) => t.name)).toEqual(BUILTIN_TOOLS.map((t) => t.name));
  });

  it('string tools array is kept as-is', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agents: [{ name: 'n', description: 'd', model: 'm', systemPrompt: 'p', tools: ['t1', 't2'], active: 1 }],
        models: [],
        tools: [],
      }),
    );
    expect(service.readConfig().agents[0].tools).toEqual(['t1', 't2']);
  });

  it('defaults teams to [] when config file has no teams field (backward compat)', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ agents: [], models: [], tools: [] }),
    );
    expect(service.readConfig().teams).toEqual([]);
  });

  it('migrates team fields and normalizes invalid mode to hierarchy', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        teams: [
          {
            name: 'dev-team',
            description: 'desc',
            supervisor: 'sup',
            workers: ['coder', 'reviewer'],
            mode: 'bad-mode',
            active: 1,
          },
        ],
      }),
    );
    const team = service.readConfig().teams[0];
    expect(team.name).toBe('dev-team');
    expect(team.supervisor).toBe('sup');
    expect(team.workers).toEqual(['coder', 'reviewer']);
    expect(team.mode).toBe('hierarchy');
    expect(team.active).toBe(1);
  });

  it('preserves agent optional fields role/capabilities/workspace/maxConcurrency', () => {
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        agents: [
          {
            name: 'coder',
            description: 'd',
            model: 'm',
            systemPrompt: 'p',
            tools: [],
            active: 1,
            role: 'supervisor',
            capabilities: ['编码'],
            workspace: 'ws/coder',
            maxConcurrency: 1,
          },
        ],
        models: [],
        tools: [],
      }),
    );
    const agent = service.readConfig().agents[0] as any;
    expect(agent.role).toBe('supervisor');
    expect(agent.capabilities).toEqual(['编码']);
    expect(agent.workspace).toBe('ws/coder');
    expect(agent.maxConcurrency).toBe(1);
  });
});
