/**
 * 定时任务配置（与 apps/cli 共享同一份 schedules.json 与字段格式）。
 * 持久化位置：<getBaseDir()>/schedules.json，内容为 ScheduleConfig[]。
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

export interface CreateScheduleDto {
  teamName: string;
  input: string;
  cron: string;
  enabled?: boolean;
}

export type UpdateScheduleDto = Partial<CreateScheduleDto>;
