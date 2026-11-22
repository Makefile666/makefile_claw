import { runTeamStream } from './create-team-graph';
import type { TeamStreamEvent } from './types';

// mock 前缀变量会被 babel-jest 提升，可在 jest.mock 工厂中安全引用
const mockDecide = jest.fn();
const mockWorker = jest.fn();

jest.mock('./team-state-store.js', () => {
  // 内存版 TeamStateStore，避免碰真实文件系统
  class MemStore {
    private data = new Map<string, any>();
    load(id: string) { return this.data.get(id) ?? null; }
    save(s: any) { this.data.set(s.teamThreadId, s); }
    init(id: string, name: string, task: string) {
      const existing = this.load(id);
      if (existing) return existing;
      const s = {
        teamThreadId: id, teamName: name, task,
        messages: [], artifacts: [], delegationHistory: [],
        status: 'running' as const, createdAt: '', updatedAt: '',
      };
      this.save(s);
      return s;
    }
  }
  return { TeamStateStore: MemStore };
});
jest.mock('./supervisor.js', () => ({
  supervisorDecide: (...a: any[]) => mockDecide(...a),
  buildSupervisorPrompt: () => '',
}));
jest.mock('./worker-runner.js', () => ({
  runWorker: (...a: any[]) => mockWorker(...a),
  extractChunkText: () => '',
}));
jest.mock('../readConfig.js', () => ({ readConfigByAgentName: () => ({ name: 'x', model: 'm' }) }));

const team = { name: 'dev-team', supervisor: 'lead', workers: ['coder', 'reviewer'], mode: 'hierarchy' as const };

async function collect(input: string, opts: any = {}, tid = 'thread-1'): Promise<TeamStreamEvent[]> {
  const out: TeamStreamEvent[] = [];
  for await (const ev of runTeamStream(team as any, input, tid, opts)) out.push(ev);
  return out;
}

describe('runTeamStream 编排循环', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // 默认 worker：推送一个 execute 事件并回写一条消息
    mockWorker.mockImplementation(async (_t: any, state: any, w: string, subtask: string, _o: any, _c: any, push: any) => {
      push({ stage: 'execute', agent: w, content: `[${w}] 完成：${subtask}`, ts: '' });
      state.messages.push({ role: 'assistant', agent: w, content: `[${w}] done`, ts: '' });
    });
  });

  it('TR-6.1 正常流程产出 delegate + execute + final 并结束', async () => {
    mockDecide
      .mockReturnValueOnce({ finish: false, delegate: 'coder', subtask: '写 hello world', parsed: true })
      .mockReturnValueOnce({ finish: true, summary: '任务完成', parsed: true });

    const events = await collect('写一个 hello world');
    const stages = events.map((e) => e.stage);
    expect(stages).toContain('delegate');
    expect(stages).toContain('execute');
    expect(stages[stages.length - 1]).toBe('final');
    expect(mockWorker).toHaveBeenCalledTimes(1);
    expect(events.find((e) => e.stage === 'delegate')?.worker).toBe('coder');
    expect(events.find((e) => e.stage === 'execute')?.agent).toBe('coder');
  });

  it('TR-6.2 worker 结果回写后下一轮 supervisor 能看到（state.messages 传递）', async () => {
    mockDecide
      .mockReturnValueOnce({ finish: false, delegate: 'coder', subtask: '写代码', parsed: true })
      .mockReturnValueOnce({ finish: false, delegate: 'reviewer', subtask: '审查代码', parsed: true })
      .mockReturnValueOnce({ finish: true, summary: 'ok', parsed: true });

    await collect('先写再审查');
    const secondCallState = mockDecide.mock.calls[1][1];
    expect(secondCallState.messages.some((m: any) => m.agent === 'coder')).toBe(true);
    expect(mockWorker).toHaveBeenCalledTimes(2);
  });

  it('TR-7.1 主管连续委派无效目标时不崩溃，降级结束', async () => {
    mockDecide.mockReturnValue({ finish: false, delegate: 'ghost', subtask: 'x', parsed: true });

    const events = await collect('任务', { maxRounds: 8 });
    const errors = events.filter((e) => e.stage === 'error');
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(events[events.length - 1].stage).toBe('final');
    expect(events[events.length - 1].content).toContain('无效');
  });

  it('达到最大轮次后降级结束（不无限循环）', async () => {
    mockDecide.mockReturnValue({ finish: false, delegate: 'coder', subtask: '再来', parsed: true });
    const events = await collect('死循环任务', { maxRounds: 3 });
    expect(events[events.length - 1].stage).toBe('final');
    expect(events[events.length - 1].content).toContain('最大委派轮次');
    expect(mockWorker).toHaveBeenCalledTimes(3);
  });

  it('TR-7.3 团队配置无效（workers 为空）时直接 error+final，不执行 worker', async () => {
    const badTeam = { name: 'bad', supervisor: 'lead', workers: [] as string[] };
    const out: TeamStreamEvent[] = [];
    for await (const ev of runTeamStream(badTeam as any, 'x', 't-bad', {})) out.push(ev);
    expect(out[0].stage).toBe('error');
    expect(out[out.length - 1].stage).toBe('final');
    expect(mockWorker).not.toHaveBeenCalled();
  });
});
