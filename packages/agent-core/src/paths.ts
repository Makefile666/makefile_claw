import path from 'node:path';
import os from 'node:os';
import { mkdirSync } from 'node:fs';

/** 数据根目录：~/.makefile_claw（可被 MAKEFILE_CLAW_HOME 覆盖，便于测试隔离） */
export const getBaseDir = (): string =>
  process.env.MAKEFILE_CLAW_HOME ?? path.join(os.homedir(), '.makefile_claw');

/** 检查点 / 团队状态目录：~/.makefile_claw/memory */
export const getMemoryDir = (): string => path.join(getBaseDir(), 'memory');

/** 工作区根目录：~/.makefile_claw/workspaces（可被 MAKEFILE_CLAW_WORKSPACE 覆盖） */
export const getWorkspaceRoot = (): string =>
  process.env.MAKEFILE_CLAW_WORKSPACE ?? path.join(getBaseDir(), 'workspaces');

/** 递归创建目录（幂等） */
export const ensureDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

/** 单 Agent 旧检查点路径：memory/<threadId>.json（保持向后兼容） */
export const getLegacyCheckpointFile = (threadId: string): string =>
  path.join(getMemoryDir(), `${threadId}.json`);

// ===== 团队两层持久化路径 =====

/** 团队共享状态文件：memory/team-<teamThreadId>.json */
export const getTeamStateFile = (teamThreadId: string): string =>
  path.join(getMemoryDir(), `team-${teamThreadId}.json`);

/** 团队子检查点目录：memory/team-<teamThreadId>/ */
export const getTeamMemoryDir = (teamThreadId: string): string =>
  path.join(getMemoryDir(), `team-${teamThreadId}`);

/** Worker 子检查点文件：memory/team-<teamThreadId>/<workerName>.json */
export const getWorkerCheckpointFile = (teamThreadId: string, workerName: string): string =>
  path.join(getTeamMemoryDir(teamThreadId), `${workerName}.json`);

// ===== 工作区隔离路径 =====

/** 团队工作区根：workspaces/<teamThreadId>/ */
export const getTeamWorkspaceDir = (teamThreadId: string): string =>
  path.join(getWorkspaceRoot(), teamThreadId);

/** Worker 独立子工作区：workspaces/<teamThreadId>/<workerName>/ */
export const getWorkerWorkspaceDir = (teamThreadId: string, workerName: string): string =>
  path.join(getTeamWorkspaceDir(teamThreadId), workerName);

/** 团队共享产物目录：workspaces/<teamThreadId>/shared/（Worker 间传文件） */
export const getSharedWorkspaceDir = (teamThreadId: string): string =>
  path.join(getTeamWorkspaceDir(teamThreadId), 'shared');
