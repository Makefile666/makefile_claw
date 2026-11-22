import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { ensureDir, getMemoryDir, getTeamStateFile } from '../paths.js';

/** 一次委派记录 */
export interface DelegationRecord {
  worker: string;
  subtask: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
}

/** 团队共享消息条目（落盘摘要，非完整对话历史） */
export interface TeamMessage {
  role: 'user' | 'assistant' | 'system';
  agent?: string;
  content: string;
  ts: string;
}

/** 团队产物（文件） */
export interface TeamArtifact {
  path: string;
  worker: string;
  description?: string;
}

/** 团队级共享状态（两层持久化的上层，所有 Worker 共享） */
export interface TeamState {
  teamThreadId: string;
  teamName: string;
  task: string;
  messages: TeamMessage[];
  artifacts: TeamArtifact[];
  delegationHistory: DelegationRecord[];
  currentWorker?: string;
  status: 'running' | 'finished' | 'failed';
  finalSummary?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 团队共享状态存储：JSON 文件 + 原子写（tmp → rename）。
 * 落盘到 ~/.makefile_claw/memory/team-<teamThreadId>.json
 */
export class TeamStateStore {
  load(teamThreadId: string): TeamState | null {
    const file = getTeamStateFile(teamThreadId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as TeamState;
    } catch {
      return null;
    }
  }

  save(state: TeamState): void {
    ensureDir(getMemoryDir());
    state.updatedAt = new Date().toISOString();
    const file = getTeamStateFile(state.teamThreadId);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8');
    renameSync(tmp, file);
  }

  /** 初始化或加载已有团队状态（同 teamThreadId 续聊时复用） */
  init(teamThreadId: string, teamName: string, task: string): TeamState {
    const existing = this.load(teamThreadId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const state: TeamState = {
      teamThreadId,
      teamName,
      task,
      messages: [],
      artifacts: [],
      delegationHistory: [],
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };
    this.save(state);
    return state;
  }
}
