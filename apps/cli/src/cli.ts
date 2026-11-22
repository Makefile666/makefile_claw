#!/usr/bin/env node
import { parseArgs, type ParseArgsConfig } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { getBaseDir } from '@makefile-claw/agent-core';
import type { TeamConfig } from '@makefile-claw/agent-core';
import { runTeamStream } from './team-runner.js';
import {
  readSchedules,
  writeSchedules,
  type ScheduleConfig,
} from './schedule-store.js';

const EXIT_OK = 0;
const EXIT_USAGE = 1;
const EXIT_EXEC = 2;

function configFile(): string {
  return join(getBaseDir(), 'makefile_claw.json');
}

function die(msg: string, code: number = EXIT_USAGE): never {
  process.stderr.write(`${msg}\n`);
  process.exit(code);
}

/** 读取 makefile_claw.json；不存在或解析失败直接退出码 1 */
function loadConfig(): Record<string, unknown> {
  const file = configFile();
  if (!existsSync(file)) {
    die(`错误：配置文件不存在：${file}`);
  }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as Record<string, unknown>;
  } catch (e) {
    die(`错误：配置文件解析失败：${(e as Error).message}`);
  }
}

function findTeam(name: string): TeamConfig {
  const config = loadConfig();
  const teams = (config.teams as TeamConfig[] | undefined) ?? [];
  const team = teams.find((t) => t.name === name);
  if (!team) {
    die(`错误：未找到团队「${name}」（配置文件：${configFile()}）`);
  }
  return team;
}

const TOP_HELP = `makefile-claw - 多智能体团队 CLI

用法:
  makefile-claw team run <teamName> --input "..." [--thread-id <id>] [--json]
  makefile-claw schedule list [--json]
  makefile-claw schedule add --team <name> --input "..." --cron "<expr>" [--no-enabled] [--json]
  makefile-claw schedule remove <id>
  makefile-claw schedule run <id> [--json]

选项:
  --help   显示帮助
  --json   机器可读输出（每行一个 JSON）

退出码:
  0  成功完成
  1  配置 / 参数 / 校验错误
  2  执行异常
`;

const TEAM_HELP = `用法: makefile-claw team run <teamName> --input "..." [--thread-id <id>] [--json]

  <teamName>       团队名称（来自 makefile_claw.json 的 teams 配置）
  --input <text>   任务输入（必填）
  --thread-id <id> 团队会话 ID，缺省自动生成
  --json           每行打印一个事件 JSON，关闭人类可读前缀
  --help           显示本帮助
`;

const SCHEDULE_HELP = `用法:
  makefile-claw schedule list [--json]
  makefile-claw schedule add --team <name> --input "..." --cron "<expr>" [--no-enabled] [--json]
  makefile-claw schedule remove <id>
  makefile-claw schedule run <id> [--json]

  list     列出所有定时任务
  add      新增定时任务（--team / --input / --cron 必填；默认启用，--no-enabled 禁用）
  remove   删除定时任务
  run      立即执行一次定时任务
`;

function parseOrDie(
  args: string[],
  options: ParseArgsConfig['options'],
): { values: Record<string, unknown>; positionals: string[] } {
  try {
    return parseArgs({
      args,
      options,
      allowPositionals: true,
      strict: true,
    }) as { values: Record<string, unknown>; positionals: string[] };
  } catch (e) {
    die(`参数错误：${(e as Error).message}`);
  }
}

// ===== team 命令 =====
async function handleTeam(sub: string | undefined, rest: string[]): Promise<number> {
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(TEAM_HELP);
    return sub ? EXIT_OK : EXIT_USAGE;
  }
  if (sub !== 'run') {
    process.stderr.write(`未知子命令：team ${sub}\n\n`);
    process.stdout.write(TEAM_HELP);
    return EXIT_USAGE;
  }
  const { values, positionals } = parseOrDie(rest, {
    input: { type: 'string' },
    'thread-id': { type: 'string' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    process.stdout.write(TEAM_HELP);
    return EXIT_OK;
  }
  const teamName = positionals[0];
  const input = values.input as string | undefined;
  if (!teamName || !input) {
    process.stderr.write('参数错误：需要 <teamName> 与 --input\n\n');
    process.stdout.write(TEAM_HELP);
    return EXIT_USAGE;
  }
  const team = findTeam(teamName);
  const threadId =
    (values['thread-id'] as string | undefined) || `cli-${teamName}-${Date.now()}`;
  const json = Boolean(values.json);
  const result = await runTeamStream(team, input, threadId, { json });
  return result.exitCode;
}

// ===== schedule 命令 =====
async function handleSchedule(sub: string | undefined, rest: string[]): Promise<number> {
  if (!sub || sub === '--help' || sub === '-h') {
    process.stdout.write(SCHEDULE_HELP);
    return sub ? EXIT_OK : EXIT_USAGE;
  }
  switch (sub) {
    case 'list':
      return scheduleList(rest);
    case 'add':
      return scheduleAdd(rest);
    case 'remove':
      return scheduleRemove(rest);
    case 'run':
      return scheduleRun(rest);
    default:
      process.stderr.write(`未知子命令：schedule ${sub}\n\n`);
      process.stdout.write(SCHEDULE_HELP);
      return EXIT_USAGE;
  }
}

function scheduleList(rest: string[]): number {
  const { values } = parseOrDie(rest, {
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    process.stdout.write(SCHEDULE_HELP);
    return EXIT_OK;
  }
  const list = readSchedules();
  const json = Boolean(values.json);
  if (json) {
    console.log(JSON.stringify(list));
    return EXIT_OK;
  }
  if (list.length === 0) {
    console.log('（无定时任务）');
    return EXIT_OK;
  }
  for (const s of list) {
    console.log(
      `${s.id}\tteam=${s.teamName}\tenabled=${s.enabled}\t` +
        `cron=${s.cron}\tlastRun=${s.lastRunAt ?? '-'}\tnextRun=${s.nextRunAt ?? '-'}`,
    );
    const preview = s.input.length > 80 ? `${s.input.slice(0, 80)}...` : s.input;
    console.log(`  input: ${preview}`);
  }
  return EXIT_OK;
}

function scheduleAdd(rest: string[]): number {
  const { values } = parseOrDie(rest, {
    team: { type: 'string' },
    input: { type: 'string' },
    cron: { type: 'string' },
    enabled: { type: 'boolean', default: true },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    process.stdout.write(SCHEDULE_HELP);
    return EXIT_OK;
  }
  const teamName = values.team as string | undefined;
  const input = values.input as string | undefined;
  const cron = values.cron as string | undefined;
  if (!teamName || !input || !cron) {
    die('参数错误：schedule add 需要 --team / --input / --cron');
  }
  // 校验团队存在（不存在则退出码 1）
  findTeam(teamName);
  const sched: ScheduleConfig = {
    id: randomUUID(),
    teamName,
    input,
    cron,
    enabled: values.enabled as boolean,
  };
  const list = readSchedules();
  list.push(sched);
  writeSchedules(list);
  if (values.json) {
    console.log(JSON.stringify(sched));
  } else {
    console.log(
      `已添加定时任务：${sched.id}（team=${teamName}, cron=${cron}, enabled=${sched.enabled}）`,
    );
  }
  return EXIT_OK;
}

function scheduleRemove(rest: string[]): number {
  const { values, positionals } = parseOrDie(rest, {
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    process.stdout.write(SCHEDULE_HELP);
    return EXIT_OK;
  }
  const id = positionals[0];
  if (!id) die('参数错误：schedule remove 需要 <id>');
  const list = readSchedules();
  if (!list.some((s) => s.id === id)) die(`未找到定时任务：${id}`);
  writeSchedules(list.filter((s) => s.id !== id));
  if (!values.json) console.log(`已删除：${id}`);
  return EXIT_OK;
}

async function scheduleRun(rest: string[]): Promise<number> {
  const { values, positionals } = parseOrDie(rest, {
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  });
  if (values.help) {
    process.stdout.write(SCHEDULE_HELP);
    return EXIT_OK;
  }
  const id = positionals[0];
  if (!id) die('参数错误：schedule run 需要 <id>');
  const list = readSchedules();
  const sched = list.find((s) => s.id === id);
  if (!sched) die(`未找到定时任务：${id}`);
  const team = findTeam(sched.teamName);
  const threadId = `schedule-${id}`;
  const result = await runTeamStream(team, sched.input, threadId, {
    json: Boolean(values.json),
  });
  // 更新 lastRunAt（无论成功或异常都记录一次触发时间）
  const refreshed = readSchedules().map((s) =>
    s.id === id ? { ...s, lastRunAt: new Date().toISOString() } : s,
  );
  writeSchedules(refreshed);
  return result.exitCode;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    process.stdout.write(TOP_HELP);
    return EXIT_OK;
  }
  switch (cmd) {
    case 'team':
      return handleTeam(sub, rest);
    case 'schedule':
      return handleSchedule(sub, rest);
    default:
      process.stderr.write(`未知命令：${cmd}\n\n`);
      process.stdout.write(TOP_HELP);
      return EXIT_USAGE;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`致命错误：${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(EXIT_EXEC);
  });
