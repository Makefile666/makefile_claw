import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { load } from 'js-yaml';
import type { SkillConfig } from './skills.types.js';

/**
 * Skills 服务
 *
 * 职责：
 * - 管理 ~/.makefile_claw/skills 目录下的所有技能
 * - 每个技能是一个文件夹，内部包含 SKILL.md（YAML frontmatter + markdown 正文）
 * - 支持：列表查询、按名称获取、安装（skills.sh 命令）、删除
 *
 * SKILL.md 格式约定（参考 langchain_ts Skills.js）：
 *   ---
 *   name: xxx
 *   description: xxx
 *   version: 1.0.0
 *   allowed-tools:
 *     - tool_a
 *     - tool_b
 *   ---
 *   技能正文规范（注入给 Agent 作为上下文）
 */
@Injectable()
export class SkillsService {
  private readonly logger = new Logger(SkillsService.name);
  /** 技能根目录：~/.makefile_claw/skills */
  private readonly skillsDir: string;

  constructor() {
    this.skillsDir = join(homedir(), '.makefile_claw', 'skills');
  }

  /** 确保技能目录存在 */
  private ensureSkillsDir(): void {
    if (!existsSync(this.skillsDir)) {
      mkdirSync(this.skillsDir, { recursive: true });
      this.logger.log(`已创建技能目录: ${this.skillsDir}`);
    }
  }

  /**
   * 解析单个 SKILL.md 文件
   * @param skillDir 技能文件夹绝对路径
   * @returns 解析后的 SkillConfig，解析失败返回 null
   */
  private parseSkillMd(skillDir: string): SkillConfig | null {
    const skillPath = join(skillDir, 'SKILL.md');
    if (!existsSync(skillPath)) return null;

    try {
      const fullContent = readFileSync(skillPath, 'utf-8');
      // 按 --- 分割：['', yaml段, 正文]
      const parts = fullContent.split('---');
      if (parts.length < 3) return null;

      const yamlStr = parts[1];
      const content = (parts[2] ?? '').trim();
      // js-yaml 解析 yaml frontmatter
      const baseData = load(yamlStr) as Record<string, unknown> | null;
      if (!baseData || typeof baseData !== 'object') return null;

      // 技能名称优先取 frontmatter 的 name，兜底用文件夹名
      const dirName = skillDir.split(/[\\/]/).filter(Boolean).pop() ?? '';
      const name = String(baseData.name ?? dirName);

      // 读取安装元数据（skill.meta.json），含来源、安装时间、安装命令、启用状态
      const meta = this.readSkillMeta(skillDir);

      return {
        name,
        description: String(baseData.description ?? ''),
        version: baseData.version != null ? String(baseData.version) : undefined,
        allowedTools: Array.isArray(baseData['allowed-tools'])
          ? (baseData['allowed-tools'] as unknown[]).map(String)
          : undefined,
        content,
        skillDir,
        skillPath,
        source: meta.source,
        installTime: meta.installTime,
        installCommand: meta.installCommand,
        active: meta.active ?? true, // 无元数据时默认启用
      };
    } catch (e) {
      this.logger.warn(
        `解析 SKILL.md 失败 ${skillPath}: ${(e as Error).message}`,
      );
      return null;
    }
  }

  /**
   * 读取技能目录下的 skill.meta.json 安装元数据
   * @param skillDir 技能文件夹绝对路径
   * @returns 元数据对象（文件不存在时返回空对象）
   */
  private readSkillMeta(skillDir: string): Partial<SkillConfig> {
    const metaPath = join(skillDir, 'skill.meta.json');
    if (!existsSync(metaPath)) return {};
    try {
      const raw = readFileSync(metaPath, 'utf-8');
      return JSON.parse(raw) as Partial<SkillConfig>;
    } catch (e) {
      this.logger.warn(
        `读取 skill.meta.json 失败 ${metaPath}: ${(e as Error).message}`,
      );
      return {};
    }
  }

  /**
   * 写入技能安装元数据到 skill.meta.json
   * @param skillDir 技能文件夹绝对路径
   * @param meta 要保存的元数据
   */
  private writeSkillMeta(skillDir: string, meta: Partial<SkillConfig>): void {
    const metaPath = join(skillDir, 'skill.meta.json');
    writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }

  /**
   * 切换技能的启用状态
   * @param name 技能名称
   * @param active 是否启用
   * @returns 更新后的技能对象
   */
  toggleActive(name: string, active: boolean): SkillConfig {
    this.ensureSkillsDir();
    const skillDir = join(this.skillsDir, name);
    if (!existsSync(skillDir)) {
      throw new NotFoundException(`Skill ${name} 不存在`);
    }
    this.logger.log(`切换技能启用状态: ${name} -> ${active ? '启用' : '停用'}`);
    const existing = this.readSkillMeta(skillDir);
    this.writeSkillMeta(skillDir, {
      ...existing,
      active,
    });
    const updated = this.findOne(name);
    this.logger.log(`技能状态已更新: ${name} = ${updated.active ? '启用' : '停用'}`);
    return updated;
  }

  /**
   * 获取所有已安装技能列表
   * 扫描技能目录下所有子文件夹，解析其中的 SKILL.md
   */
  findAll(): SkillConfig[] {
    this.ensureSkillsDir();
    const entries = readdirSync(this.skillsDir);
    const skills: SkillConfig[] = [];
    for (const entry of entries) {
      const fullPath = join(this.skillsDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isDirectory()) continue;
        const skill = this.parseSkillMd(fullPath);
        if (skill) skills.push(skill);
      } catch {
        // 忽略无法访问的条目
      }
    }
    this.logger.log(`查询技能列表，共 ${skills.length} 个已安装技能`);
    return skills;
  }

  /**
   * 按名称获取单个技能的完整内容
   * @param name 技能名称（文件夹名）
   */
  findOne(name: string): SkillConfig {
    this.ensureSkillsDir();
    const skillDir = join(this.skillsDir, name);
    const skill = this.parseSkillMd(skillDir);
    if (!skill) {
      throw new NotFoundException(`Skill ${name} 不存在`);
    }
    this.logger.log(
      `查询技能详情: ${name}（${skill.active ? '已启用' : '已停用'}，正文 ${skill.content.length} 字符）`,
    );
    return skill;
  }

  /**
   * 从安装命令中解析期望安装的技能名称
   * 支持的命令格式：
   *   npx skills add owner/repo
   *   npx skills add skill-name
   *   npx skills add https://github.com/owner/repo --skill grill-me
   *   pnpm dlx skills add https://github.com/anthropics/skills --skill frontend-design
   *   npx -y skills add owner/repo
   *
   * 解析规则：
   * - 若命令含 --skill <name>，则 name 即为期望安装的技能名
   * - 否则取 skills add 之后的第一个非选项参数（repo 或 URL），
   *   从中提取最后一段作为技能名（owner/repo -> repo，URL -> 末段）
   *
   * @param command 用户粘贴的安装命令
   * @returns 期望安装的技能名称
   */
  private extractExpectedSkillName(command: string): string {
    const trimmed = command.trim();
    if (!trimmed) {
      throw new BadRequestException('安装命令不能为空');
    }

    // 按空白拆分 token
    const tokens = trimmed.split(/\s+/);

    // 1. 优先查找 --skill <name>
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i] === '--skill' && i + 1 < tokens.length) {
        return tokens[i + 1];
      }
      // 支持 --skill=name 形式
      if (tokens[i].startsWith('--skill=')) {
        return tokens[i].slice('--skill='.length);
      }
    }

    // 2. 否则找 skills add 之后的第一个非选项参数
    const addIdx = tokens.indexOf('add');
    if (addIdx >= 0) {
      for (let i = addIdx + 1; i < tokens.length; i++) {
        const t = tokens[i];
        if (!t.startsWith('-')) {
          // 从 URL 或 owner/repo 中提取末段
          const segments = t.split(/[\\/]/).filter(Boolean);
          return segments[segments.length - 1] ?? t;
        }
      }
    }

    throw new BadRequestException(`无法从命令中解析技能名称: ${command}`);
  }

  /**
   * 把用户的安装命令转换为可执行形式
   * - 优先使用 pnpm dlx（本项目基于 pnpm，比 npx 更稳定）
   * - 将开头的 npx / npx -y / npm exec 替换为 pnpm dlx
   * - 追加 -y -a '*' 以支持非交互式安装（skills CLI 默认需要 TTY 交互选择技能）
   * - 其余参数原样保留（URL、--skill 等）
   * @param command 用户粘贴的安装命令
   * @returns 转换后的可执行命令字符串
   */
  private buildExecCommand(command: string): string {
    let cmd = command.trim();
    // 把 npx / npx -y / npm exec 等前缀替换为 pnpm dlx
    cmd = cmd.replace(/^npx\s+(-y\s+|--yes\s+)?/, 'pnpm dlx ');
    cmd = cmd.replace(/^npm\s+exec\s+(-y\s+|--yes\s+)?/, 'pnpm dlx ');

    // skills CLI 在非 TTY 环境下需要显式指定非交互式标志，否则会报
    // "Interactive prompt required but stdin is not a TTY" 并取消安装。
    // -y: 跳过确认提示；-a '*': 安装到所有 agent（技能文件本身落在 .agents/skills/）
    if (!/-y\b|--yes\b/.test(cmd)) {
      cmd += ' -y';
    }
    if (!/-a\s|--agent\b/.test(cmd)) {
      cmd += " -a '*'";
    }
    return cmd;
  }

  /**
   * 安装技能
   * 通过 skills.sh 站点提供的安装命令安装技能。
   *
   * 实现策略：
   * 1. 从命令中解析出期望安装的技能名（--skill 参数或 repo 末段）
   * 2. 将用户命令中的 npx 替换为 pnpm dlx（更稳定），通过 shell 执行
   * 3. 设置 SKILLS_HOME / SKILLS_DIR 环境变量引导安装到 ~/.makefile_claw/skills
   * 4. 安装后检测新增技能，优先匹配期望名称
   * 5. 若 skills CLI 未识别环境变量，兜底扫描常见安装位置并迁移
   *
   * @param command skills.sh 安装命令
   * @returns 安装后的技能对象
   */
  install(command: string): SkillConfig {
    this.ensureSkillsDir();
    const expectedName = this.extractExpectedSkillName(command);
    const execCmd = this.buildExecCommand(command);
    const repoUrl = this.extractRepoUrl(command);
    this.logger.log(
      `开始安装技能: ${expectedName}，repo: ${repoUrl ?? '(无法解析)'}，执行命令: ${execCmd}`,
    );

    // 记录安装前已有技能名集合，用于安装后检测新增技能
    const before = new Set(this.findAll().map((s) => s.name));
    this.logger.log(`安装前已有 ${before.size} 个技能: ${[...before].join(', ') || '(无)'}`);

    // 清理 skills CLI 残留目录，避免上次安装的无关技能干扰本次匹配
    // （只清理 .agents/skills 下不在 before 中的条目）
    this.cleanupLeftoverAgentsSkills(before);

    // 设置环境变量引导安装目录到规范位置
    const env = {
      ...process.env,
      SKILLS_HOME: this.skillsDir,
      SKILLS_DIR: this.skillsDir,
      AGENTS_HOME: join(homedir(), '.makefile_claw'),
      NPM_CONFIG_LOGLEVEL: 'silent',
      NPM_CONFIG_FUND: 'false',
      NODE_NO_WARNINGS: '1',
    };

    // Windows 下 .cmd/.bat 文件必须通过 shell 执行，否则 execFileSync 会 EINVAL。
    // 使用 shell: true 跨平台兼容，直接执行完整命令字符串。
    this.logger.log(`[主路径] 执行安装命令（超时 180s）: ${execCmd}`);
    const execStart = Date.now();
    let cmdRan = false;
    try {
      execFileSync(execCmd, {
        env,
        cwd: this.skillsDir,
        stdio: 'pipe',
        timeout: 180_000,
        shell: true,
      });
      cmdRan = true;
      this.logger.log(`[主路径] 安装命令执行成功，耗时 ${Date.now() - execStart}ms`);
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      // ENOENT 表示命令本身不存在（如 pnpm 未安装），直接报错
      if (err.code === 'ENOENT') {
        throw new BadRequestException(
          `未找到执行命令所需的程序，请确保已安装 pnpm/npx。原始错误: ${err.message}`,
        );
      }
      // 其他错误（网络失败、非零退出码等）：命令实际执行过，
      // 可能已将技能安装到了其他目录，继续走兜底扫描逻辑。
      cmdRan = true;
      this.logger.warn(
        `[主路径] skills add 执行警告（耗时 ${Date.now() - execStart}ms）: ${err.message}`,
      );
    }

    // 检测安装后的技能：优先在规范目录查找，其次扫描常见兜底目录并迁移
    this.logger.log(`检测新增技能，期望名称: ${expectedName}`);
    let installed = this.detectNewSkill(before, expectedName);
    if (installed) {
      this.logger.log(`在规范目录检测到新增技能: ${installed.name}`);
    } else if (cmdRan) {
      this.logger.log('规范目录未检测到新增技能，开始扫描常见安装位置...');
      installed = this.scanAndMigrate(before, expectedName);
    }

    // 主路径未找到匹配技能时，回退到 git clone 镜像方式安装
    if (!installed) {
      if (repoUrl) {
        this.logger.log(
          `[主路径] 未找到匹配「${expectedName}」的技能，回退到 git clone 备用路径`,
        );
        installed = this.installViaGitClone(repoUrl, expectedName);
      } else {
        throw new BadRequestException(
          `技能安装失败，未检测到新增技能「${expectedName}」，且无法从命令中解析 GitHub 仓库地址。请检查命令是否正确：${command}`,
        );
      }
    }

    if (!installed) {
      throw new BadRequestException(
        `技能安装失败，未检测到新增技能「${expectedName}」。请检查命令是否正确或网络是否可用：${command}`,
      );
    }

    // 保存安装元数据（来源、安装时间、安装命令、启用状态）
    const source = this.extractSource(command);
    this.writeSkillMeta(installed.skillDir, {
      source,
      installTime: new Date().toISOString(),
      installCommand: command,
      active: true,
    });
    // 重新读取以包含最新元数据
    installed = this.findOne(installed.name);

    this.logger.log(`技能安装成功: ${installed.name}`);
    return installed;
  }

  /**
   * 清理 skills CLI 残留的 .agents/skills 目录中不在 before 中的技能
   * 避免上次安装残留的无关技能干扰本次匹配
   */
  private cleanupLeftoverAgentsSkills(before: Set<string>): void {
    const agentsSkillsDir = join(this.skillsDir, '.agents', 'skills');
    if (!existsSync(agentsSkillsDir)) return;
    try {
      const entries = readdirSync(agentsSkillsDir);
      let cleaned = 0;
      for (const entry of entries) {
        // 保留 before 中已有的（这些是之前安装但未迁移的，可能还需要）
        if (before.has(entry)) continue;
        const entryPath = join(agentsSkillsDir, entry);
        try {
          const stat = statSync(entryPath);
          if (stat.isDirectory()) {
            rmSync(entryPath, { recursive: true, force: true });
            cleaned++;
          }
        } catch {
          // 忽略单个条目错误
        }
      }
      if (cleaned > 0) {
        this.logger.log(`清理了 ${cleaned} 个残留技能目录: ${agentsSkillsDir}`);
      }
    } catch {
      // 忽略目录读取错误
    }
  }

  /**
   * 从安装命令中提取技能来源（repo URL 或 owner/repo）
   * 即 skills add 之后的第一个非选项参数
   */
  private extractSource(command: string): string | undefined {
    const tokens = command.trim().split(/\s+/);
    const addIdx = tokens.indexOf('add');
    if (addIdx < 0) return undefined;
    for (let i = addIdx + 1; i < tokens.length; i++) {
      const t = tokens[i];
      if (!t.startsWith('-')) return t;
    }
    return undefined;
  }

  /**
   * 从安装命令中提取 GitHub repo URL
   * 支持：https://github.com/owner/repo、owner/repo、github.com/owner/repo
   * @returns 完整的 https github URL，无法解析返回 undefined
   */
  private extractRepoUrl(command: string): string | undefined {
    const source = this.extractSource(command);
    if (!source) return undefined;
    // 已是完整 URL
    if (source.startsWith('http://') || source.startsWith('https://')) {
      return source.replace(/\.git$/, '');
    }
    // owner/repo 形式
    if (/^[^/\s]+\/[^/\s]+$/.test(source)) {
      return `https://github.com/${source}`;
    }
    // github.com/owner/repo 形式
    if (source.startsWith('github.com/')) {
      return `https://${source}`;
    }
    return undefined;
  }

  /**
   * 在克隆的 repo 目录中递归查找含 SKILL.md 的技能文件夹
   * @param repoDir 克隆的 repo 根目录
   * @param expectedName 期望的技能名（精确优先，模糊兜底）
   * @returns 匹配的技能文件夹绝对路径，未找到返回 null
   */
  private findSkillDirInRepo(repoDir: string, expectedName?: string): string | null {
    const results: { path: string; name: string }[] = [];

    const walk = (dir: string) => {
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          // 跳过 .git 目录
          if (entry.name === '.git') continue;
          const fullPath = join(dir, entry.name);
          if (existsSync(join(fullPath, 'SKILL.md'))) {
            results.push({ path: fullPath, name: entry.name });
          }
          // 继续递归子目录（技能可能嵌套在 skills/ 或 .claude/skills/ 下）
          walk(fullPath);
        }
      } catch {
        // 忽略无权限目录
      }
    };
    walk(repoDir);

    if (results.length === 0) return null;

    if (expectedName) {
      // 精确匹配
      let matched = results.find((r) => r.name === expectedName);
      if (!matched) {
        // 模糊匹配
        matched = results.find((r) => this.fuzzyMatchName(r.name, expectedName));
      }
      if (matched) return matched.path;
      this.logger.log(
        `repo 中未找到匹配「${expectedName}」的技能，可用技能: ${results.map((r) => r.name).join(', ')}`,
      );
      return null;
    }
    return results[0].path;
  }

  /**
   * 备用安装方式：通过 git clone 镜像 + 复制技能目录
   * 用于 pnpm dlx skills add 失败（网络问题等）时的兜底。
   *
   * 流程：
   * 1. 将 github.com 替换为 ghfast.top 镜像
   * 2. git clone 到临时目录
   * 3. 在 repo 中查找 expectedName 对应的技能文件夹（含 SKILL.md）
   * 4. 复制到 ~/.makefile_claw/skills/<name>/
   * 5. 清理临时目录
   *
   * @param repoUrl GitHub repo URL
   * @param expectedName 期望安装的技能名
   * @returns 安装后的技能对象
   */
  private installViaGitClone(repoUrl: string, expectedName: string): SkillConfig {
    this.logger.log(`[备用路径] git clone 安装: ${repoUrl}，期望技能: ${expectedName}`);

    // 构造镜像 URL：https://github.com/owner/repo -> https://ghfast.top/https://github.com/owner/repo
    const mirrorUrl = repoUrl.includes('ghfast.top')
      ? repoUrl
      : `https://ghfast.top/${repoUrl}`;

    // 临时目录放在 skillsDir 下，便于清理
    const tempName = `temp-skill-${Date.now()}`;
    const tempDir = join(this.skillsDir, tempName);

    try {
      this.logger.log(`[备用路径] 克隆镜像: ${mirrorUrl} -> ${tempDir}`);
      execFileSync('git', ['clone', mirrorUrl, tempDir], {
        cwd: this.skillsDir,
        stdio: 'pipe',
        timeout: 120_000,
      });
      this.logger.log(`[备用路径] 克隆完成`);

      // 在 repo 中查找匹配的技能目录
      const skillSrc = this.findSkillDirInRepo(tempDir, expectedName);
      if (!skillSrc) {
        throw new BadRequestException(
          `在仓库中未找到技能「${expectedName}」。请检查 --skill 名称是否正确，或仓库是否包含该技能。`,
        );
      }

      const skillName = skillSrc.split(/[\\/]/).pop()!;
      const destPath = join(this.skillsDir, skillName);
      this.logger.log(`[备用路径] 复制技能: ${skillSrc} -> ${destPath}`);

      // 目标已存在则先删除
      if (existsSync(destPath)) {
        rmSync(destPath, { recursive: true, force: true });
      }
      cpSync(skillSrc, destPath, { recursive: true });

      // 验证 SKILL.md 存在
      const skill = this.parseSkillMd(destPath);
      if (!skill) {
        rmSync(destPath, { recursive: true, force: true });
        throw new BadRequestException(`技能目录 ${skillName} 中未找到有效的 SKILL.md`);
      }

      this.logger.log(`[备用路径] 技能安装成功: ${skillName}`);
      return skill;
    } finally {
      // 清理临时目录
      if (existsSync(tempDir)) {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {
          this.logger.warn(`[备用路径] 清理临时目录失败: ${tempDir}`);
        }
      }
    }
  }

  /**
   * 名称模糊匹配：判断 actual 是否与 expected 匹配
   * 规则：精确相等 > actual 以 expected 开头/结尾 > expected 以 actual 开头/结尾 > 互相包含
   * 用于在 skills CLI 安装的技能文件夹名与 --skill 指定名不完全一致时兜底匹配
   */
  private fuzzyMatchName(actual: string, expected: string): boolean {
    if (!actual || !expected) return false;
    const a = actual.toLowerCase();
    const e = expected.toLowerCase();
    if (a === e) return true;
    if (a.startsWith(e) || a.endsWith(e)) return true;
    if (e.startsWith(a) || e.endsWith(a)) return true;
    return a.includes(e) || e.includes(a);
  }

  /**
   * 在规范目录 ~/.makefile_claw/skills 中检测新增技能
   * @param before 安装前已有的技能名集合
   * @param preferredName 期望匹配的技能名（必须匹配，找不到返回 null）
   * @returns 新增的技能对象，未找到返回 null
   */
  private detectNewSkill(before: Set<string>, preferredName?: string): SkillConfig | null {
    const skills = this.findAll();
    const newSkills = skills.filter((s) => !before.has(s.name));
    if (newSkills.length === 0) return null;
    if (preferredName) {
      // 优先精确匹配
      let matched = newSkills.find((s) => s.name === preferredName);
      if (!matched) {
        // 兜底模糊匹配（如 ui-ux-pro-max 匹配 ui-ux-pro-max-skill）
        matched = newSkills.find((s) => this.fuzzyMatchName(s.name, preferredName));
      }
      if (matched) return matched;
      this.logger.log(`规范目录中未找到匹配「${preferredName}」的技能，候选: ${newSkills.map((s) => s.name).join(', ')}`);
      return null;
    }
    return newSkills[0];
  }

  /**
   * 扫描常见的 skills 安装目录，把新增技能迁移到规范目录
   * 兜底处理 skills CLI 不识别 SKILLS_HOME 的情况
   * @param before 安装前已有的技能名集合
   * @param preferredName 期望匹配的技能名（优先迁移名称匹配的技能）
   * @returns 迁移后的技能对象
   */
  private scanAndMigrate(before: Set<string>, preferredName?: string): SkillConfig | null {
    const home = homedir();
    // skills CLI 常见的默认安装目录
    // 注意：execFileSync 以 this.skillsDir 为 cwd 执行，skills CLI 会把技能安装到
    //       <this.skillsDir>/.agents/skills/，因此必须把该路径纳入扫描范围。
    const candidateDirs = [
      join(home, '.agents', 'skills'),
      join(home, '.claude', 'skills'),
      join(this.skillsDir, '.agents', 'skills'),
      join(process.cwd(), '.agents', 'skills'),
      join(process.cwd(), '.claude', 'skills'),
    ];

    this.logger.log(`扫描 ${candidateDirs.length} 个候选目录...`);

    // 收集所有候选的"新增技能"（不在 before 中、含 SKILL.md、目标目录无同名）
    type Candidate = { srcPath: string; name: string };
    const candidates: Candidate[] = [];
    for (const dir of candidateDirs) {
      const exists = existsSync(dir);
      if (!exists) {
        this.logger.log(`  跳过（不存在）: ${dir}`);
        continue;
      }
      try {
        const entries = readdirSync(dir);
        this.logger.log(`  扫描目录: ${dir}（${entries.length} 个条目）`);
        for (const entry of entries) {
          const srcPath = join(dir, entry);
          try {
            const stat = statSync(srcPath);
            if (!stat.isDirectory()) continue;
            if (!existsSync(join(srcPath, 'SKILL.md'))) continue;
            if (before.has(entry)) continue;
            const destPath = join(this.skillsDir, entry);
            if (existsSync(destPath)) continue;
            candidates.push({ srcPath, name: entry });
            this.logger.log(`    发现候选技能: ${entry}`);
          } catch {
            // 忽略单个条目错误
          }
        }
      } catch {
        // 忽略目录读取错误
      }
    }

    if (candidates.length === 0) {
      this.logger.log('未在任何候选目录中发现新增技能');
      return null;
    }

    this.logger.log(`共发现 ${candidates.length} 个候选技能: ${candidates.map((c) => c.name).join(', ')}`);

    // 有期望名称时，必须匹配（精确优先，模糊兜底），找不到则返回 null，
    // 避免把上次残留的无关技能（如 vercel-cli-with-tokens）误迁移。
    let target: Candidate | undefined;
    if (preferredName) {
      target = candidates.find((c) => c.name === preferredName);
      if (!target) {
        target = candidates.find((c) => this.fuzzyMatchName(c.name, preferredName));
      }
      if (!target) {
        this.logger.log(
          `候选技能中未找到匹配「${preferredName}」的技能，拒绝迁移第一个候选以避免装错`,
        );
        return null;
      }
    } else {
      target = candidates[0];
    }

    this.logger.log(`迁移技能: ${target.name} 从 ${target.srcPath} -> ${this.skillsDir}`);
    const destPath = join(this.skillsDir, target.name);
    mkdirSync(this.skillsDir, { recursive: true });
    // 用 rename 移动文件夹；跨设备时 rename 会失败，降级为递归复制 + 删除源
    try {
      renameSync(target.srcPath, destPath);
    } catch {
      this.logger.log(`rename 失败，降级为复制+删除`);
      cpSync(target.srcPath, destPath, { recursive: true });
      rmSync(target.srcPath, { recursive: true, force: true });
    }

    return this.parseSkillMd(destPath);
  }

  /**
   * 删除技能（按名称，即文件夹名）
   * @param name 技能名称
   */
  remove(name: string): void {
    this.ensureSkillsDir();
    const skillDir = join(this.skillsDir, name);
    if (!existsSync(skillDir)) {
      throw new NotFoundException(`Skill ${name} 不存在`);
    }
    rmSync(skillDir, { recursive: true, force: true });
    this.logger.log(`已删除技能: ${name}`);
  }
}
