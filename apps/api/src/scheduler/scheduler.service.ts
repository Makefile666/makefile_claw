import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  createTeamGraph,
  ensureDir,
  getBaseDir,
  getMemoryDir,
} from '@makefile-claw/agent-core';
import type { TeamConfig } from '@makefile-claw/agent-core';
import { schedule as cronSchedule, validate as cronValidate } from 'node-cron';
import type { ScheduledTask } from 'node-cron';
import { ClawConfigService } from '../claw-config/claw-config.service.js';
import type {
  CreateScheduleDto,
  ScheduleConfig,
  UpdateScheduleDto,
} from './scheduler.types.js';

/**
 * 定时任务调度器：
 * - 持久化 schedules.json（原子写）
 * - onModuleInit 加载并为 enabled 任务注册 node-cron
 * - 触发时以无 HTTP 方式调用 createTeamGraph 跑完，把摘要追加到 memory/schedule-<id>.log
 * - 复用进程池：仅内部 release，绝不调用 agentPool.closeAll()（避免杀掉全局 MCP 影响后续任务）
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private readonly tasks = new Map<string, ScheduledTask>();
  /** 正在执行的 schedule id，防止同一任务重叠触发 */
  private readonly running = new Set<string>();

  constructor(private readonly clawConfigService: ClawConfigService) {}

  private get schedulesFile(): string {
    return join(getBaseDir(), 'schedules.json');
  }

  onModuleInit(): void {
    ensureDir(getBaseDir());
    const schedules = this.loadSchedules();
    for (const s of schedules) {
      if (s.enabled) this.registerCron(s);
    }
    this.logger.log(
      `定时任务调度器已启动，共注册 ${this.tasks.size}/${schedules.length} 个启用任务`,
    );
  }

  onModuleDestroy(): void {
    for (const task of this.tasks.values()) {
      try {
        task.stop();
      } catch {
        /* ignore */
      }
    }
    this.tasks.clear();
  }

  // ===== 持久化 =====

  private normalize(raw: Record<string, unknown>): ScheduleConfig {
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

  private loadSchedules(): ScheduleConfig[] {
    const file = this.schedulesFile;
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf-8'));
      if (Array.isArray(parsed)) {
        return parsed.map((r) => this.normalize(r as Record<string, unknown>));
      }
      if (parsed && Array.isArray((parsed as { schedules?: unknown[] }).schedules)) {
        return (parsed as { schedules: Record<string, unknown>[] }).schedules.map(
          (r) => this.normalize(r),
        );
      }
      return [];
    } catch (e) {
      this.logger.warn(`读取 schedules.json 失败: ${(e as Error).message}`);
      return [];
    }
  }

  /** 原子写入：先写 .tmp 再 rename，带重试以应对 Windows 文件锁定（Defender） */
  private atomicWrite(content: string): void {
    const file = this.schedulesFile;
    const tmp = `${file}.tmp`;
    for (let i = 0; i < 20; i++) {
      try {
        writeFileSync(tmp, content, 'utf-8');
        renameSync(tmp, file);
        return;
      } catch {
        const waitMs = 200 * (i + 1);
        const end = Date.now() + waitMs;
        while (Date.now() < end) {
          // busy wait
        }
      }
    }
    // 兜底：直接写入（会抛出原始错误）
    writeFileSync(file, content, 'utf-8');
  }

  private saveSchedules(list: ScheduleConfig[]): void {
    ensureDir(getBaseDir());
    this.atomicWrite(JSON.stringify(list, null, 2));
  }

  // ===== cron 注册 =====

  private registerCron(schedule: ScheduleConfig): void {
    this.stopCron(schedule.id);
    if (!schedule.cron || !cronValidate(schedule.cron)) {
      this.logger.warn(
        `定时任务 ${schedule.id} 的 cron 表达式无效，跳过注册: ${schedule.cron}`,
      );
      return;
    }
    try {
      const task = cronSchedule(schedule.cron, () => {
        this.executeSchedule(schedule).catch((e) =>
          this.logger.error(
            `定时任务触发异常 id=${schedule.id}: ${(e as Error).message}`,
          ),
        );
      });
      this.tasks.set(schedule.id, task);
    } catch (e) {
      this.logger.error(`注册定时任务失败 id=${schedule.id}: ${(e as Error).message}`);
    }
  }

  private stopCron(id: string): void {
    const task = this.tasks.get(id);
    if (task) {
      try {
        task.stop();
      } catch {
        /* ignore */
      }
      this.tasks.delete(id);
    }
  }

  // ===== 团队执行 =====

  /** 从配置中取出团队，并归一化为 agent-core 的 TeamConfig（避免 active 类型差异） */
  private findTeam(teamName: string): TeamConfig {
    const config = this.clawConfigService.readConfig();
    const t = config.teams.find((x) => x.name === teamName);
    if (!t) {
      throw new NotFoundException(`团队不存在: ${teamName}`);
    }
    return {
      name: t.name,
      supervisor: t.supervisor,
      workers: t.workers,
      mode: t.mode,
      maxParallelWorkers: t.maxParallelWorkers,
    };
  }

  private appendRunLog(
    id: string,
    startedAt: Date,
    ok: boolean,
    errorMsg: string | undefined,
    summary: string,
  ): void {
    try {
      ensureDir(getMemoryDir());
      const logFile = join(getMemoryDir(), `schedule-${id}.log`);
      const header = `[${startedAt.toISOString()}] schedule=${id} ok=${ok}${
        errorMsg ? ` error=${errorMsg}` : ''
      }`;
      const body = summary ? `\n${summary}` : '';
      appendFileSync(logFile, `${header}${body}\n---\n`, 'utf-8');
    } catch (e) {
      this.logger.warn(`写入定时任务日志失败 id=${id}: ${(e as Error).message}`);
    }
  }

  private updateLastRunAt(id: string): void {
    try {
      const list = this.loadSchedules();
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return;
      list[idx] = { ...list[idx], lastRunAt: new Date().toISOString() };
      this.saveSchedules(list);
    } catch (e) {
      this.logger.warn(`更新 lastRunAt 失败 id=${id}: ${(e as Error).message}`);
    }
  }

  /** 执行一次定时任务：跑完团队流，记录日志与 lastRunAt；复用进程池，不 closeAll */
  private async executeSchedule(
    schedule: ScheduleConfig,
  ): Promise<{ ok: boolean; summary?: string }> {
    if (this.running.has(schedule.id)) {
      this.logger.warn(`定时任务 ${schedule.id} 仍在执行，跳过本次触发`);
      return { ok: false, summary: '任务仍在执行，已跳过本次触发' };
    }
    this.running.add(schedule.id);
    const startedAt = new Date();
    let summary = '';
    let ok = false;
    let errorMsg: string | undefined;
    try {
      const team = this.findTeam(schedule.teamName);
      const graph = createTeamGraph(team, `schedule-${schedule.id}`);
      const stream = graph.stream(schedule.input, { maxRounds: 8 });
      for await (const ev of stream) {
        if (ev.stage === 'final' && ev.content) summary = ev.content;
      }
      ok = true;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`定时任务执行异常 id=${schedule.id}: ${errorMsg}`);
      summary = `执行异常：${errorMsg}`;
    } finally {
      this.running.delete(schedule.id);
      this.appendRunLog(schedule.id, startedAt, ok, errorMsg, summary);
      this.updateLastRunAt(schedule.id);
    }
    return { ok, summary: summary || undefined };
  }

  // ===== 对外 CRUD =====

  findAll(): ScheduleConfig[] {
    return this.loadSchedules();
  }

  findOne(id: string): ScheduleConfig {
    const s = this.loadSchedules().find((x) => x.id === id);
    if (!s) throw new NotFoundException(`定时任务 ${id} 不存在`);
    return s;
  }

  create(dto: CreateScheduleDto): ScheduleConfig {
    if (!dto.teamName) throw new BadRequestException('缺少 teamName');
    if (!dto.input) throw new BadRequestException('缺少 input');
    if (!dto.cron) throw new BadRequestException('缺少 cron');
    if (!cronValidate(dto.cron)) {
      throw new BadRequestException(`cron 表达式无效: ${dto.cron}`);
    }
    // 校验团队存在（不存在抛 NotFoundException）
    this.findTeam(dto.teamName);
    const sched: ScheduleConfig = {
      id: randomUUID(),
      teamName: dto.teamName,
      input: dto.input,
      cron: dto.cron,
      enabled: dto.enabled ?? true,
    };
    const list = this.loadSchedules();
    list.push(sched);
    this.saveSchedules(list);
    if (sched.enabled) this.registerCron(sched);
    return sched;
  }

  update(id: string, dto: UpdateScheduleDto): ScheduleConfig {
    const list = this.loadSchedules();
    const idx = list.findIndex((s) => s.id === id);
    if (idx === -1) throw new NotFoundException(`定时任务 ${id} 不存在`);
    if (dto.cron && !cronValidate(dto.cron)) {
      throw new BadRequestException(`cron 表达式无效: ${dto.cron}`);
    }
    if (dto.teamName) this.findTeam(dto.teamName);
    const next: ScheduleConfig = { ...list[idx], ...dto };
    list[idx] = next;
    this.saveSchedules(list);
    this.stopCron(id);
    if (next.enabled) this.registerCron(next);
    return next;
  }

  remove(id: string): void {
    const list = this.loadSchedules();
    if (!list.some((s) => s.id === id)) {
      throw new NotFoundException(`定时任务 ${id} 不存在`);
    }
    this.stopCron(id);
    this.saveSchedules(list.filter((s) => s.id !== id));
  }

  /** 立即执行一次（不经过 cron） */
  async runNow(id: string): Promise<{ ok: boolean; summary?: string }> {
    const sched = this.findOne(id);
    return this.executeSchedule(sched);
  }
}
