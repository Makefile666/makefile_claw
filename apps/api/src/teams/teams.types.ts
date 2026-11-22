import type { TeamConfig } from '../claw-config/claw-config.types.js';

/** 创建 Team 时的入参（name 为唯一标识；active 可选，默认 1；时间戳由服务端生成） */
export type CreateTeamDto = Omit<TeamConfig, 'active' | 'createdAt' | 'updatedAt'> & {
  active?: number;
};

/** 更新 Team 时的入参（所有字段可选） */
export type UpdateTeamDto = Partial<CreateTeamDto>;

export { TeamConfig };
