import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { getBaseDir, ensureDir } from '@makefile-claw/agent-core';

/**
 * 定时任务配置（与 apps/api SchedulerModule 共享同一份文件与格式）。
 * 文件位置：<getBaseDir()>/schedules.json，内容为 ScheduleConfig[] 的 JSON 数组。
 */
export interface ScheduleConfig {
  id: string;
  teamName: string;
  input: string;
  cron: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
}

export function getSchedulesFile(): string {
  return join(getBaseDir(), 'schedules.json');
}

function normalize(raw: Record<string, unknown>): ScheduleConfig {
  return {
    id: String(raw.id ?? ''),
    teamName: String(raw.teamName ?? ''),
    input: String(raw.input ?? ''),
    cron: String(raw.cron ?? ''),
    enabled: Boolean(raw.enabled),
    lastRunAt: raw.lastRunAt != null ? String(raw.lastRunAt) : undefined,
    nextRunAt: raw.nextRunAt != null ? String(raw.nextRunAt) : undefined,
  };
}

/** 读取 schedules.json；文件不存在或解析失败时返回空数组（不抛错） */
export function readSchedules(): ScheduleConfig[] {
  const file = getSchedulesFile();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    if (Array.isArray(parsed)) return parsed.map((r) => normalize(r as Record<string, unknown>));
    if (parsed && Array.isArray((parsed as { schedules?: unknown[] }).schedules)) {
      return (parsed as { schedules: Record<string, unknown>[] }).schedules.map(normalize);
    }
    return [];
  } catch {
    return [];
  }
}

/** 原子写入 schedules.json：先写 .tmp 再 rename，带重试以应对 Windows 文件锁定 */
export function writeSchedules(list: ScheduleConfig[]): void {
  const file = getSchedulesFile();
  ensureDir(getBaseDir());
  const tmp = `${file}.tmp`;
  const content = JSON.stringify(list, null, 2);
  for (let i = 0; i < 10; i++) {
    try {
      writeFileSync(tmp, content, 'utf-8');
      renameSync(tmp, file);
      return;
    } catch {
      const waitMs = 100 * (i + 1);
      const end = Date.now() + waitMs;
      while (Date.now() < end) {
        // busy wait
      }
    }
  }
  // 兜底：直接写入（会抛出原始错误）
  writeFileSync(file, content, 'utf-8');
}
