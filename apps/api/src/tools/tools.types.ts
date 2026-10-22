import type { ToolConfig } from '../claw-config/claw-config.types.js';

/** 创建 Tool 时的入参（不含 active 可选，默认 0；builtin 可选，默认 0） */
export type CreateToolDto = Omit<ToolConfig, 'active' | 'builtin'> & {
  active?: number;
  builtin?: number;
};

/** 更新 Tool 时的入参（所有字段可选） */
export type UpdateToolDto = Partial<CreateToolDto>;

export { ToolConfig };
