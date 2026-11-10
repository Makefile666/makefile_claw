/**
 * Skill 技能配置类型
 * 对应 SKILL.md 文件解析后的结构：
 * - 元数据（YAML frontmatter）：name、description、version 等基础信息
 * - 正文内容（markdown）：注入给 Agent 作为任务规范上下文
 *
 * 安装元数据（source/installTime/installCommand/active）保存在技能目录下的
 * skill.meta.json 中，与 SKILL.md 并列。
 */
export interface SkillConfig {
  /** 技能英文名称（唯一键，即技能文件夹名） */
  name: string;
  /** 技能简要描述 */
  description: string;
  /** 技能版本号（可选） */
  version?: string;
  /** 允许使用的工具列表（可选，来自 frontmatter 的 allowed-tools） */
  allowedTools?: string[];
  /** 技能正文内容（SKILL.md 中 --- 之后的 markdown 规范文档） */
  content: string;
  /** SKILL.md 所在文件夹绝对路径 */
  skillDir: string;
  /** SKILL.md 文件绝对路径 */
  skillPath: string;
  /** 技能来源（GitHub repo 地址或 owner/repo） */
  source?: string;
  /** 安装时间（ISO 字符串） */
  installTime?: string;
  /** 安装时使用的命令 */
  installCommand?: string;
  /** 是否启用（true-启用，false-停用），停用后不会注入到 Agent */
  active: boolean;
}

/** 安装技能的入参 */
export interface InstallSkillDto {
  /** skills.sh 站点提供的安装命令，例如：npx skills add owner/repo */
  command: string;
}

/** 切换技能启用状态的入参 */
export interface ToggleSkillActiveDto {
  /** 是否启用 */
  active: boolean;
}
