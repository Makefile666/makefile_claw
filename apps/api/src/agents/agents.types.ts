import type { AgentConfig } from '../claw-config/claw-config.types.js';

/** 创建 Agent 时的入参（name 为唯一标识；active 可选，默认 1） */
export type CreateAgentDto = Omit<AgentConfig, 'active'> & {
  active?: number;
};

/** 更新 Agent 时的入参（所有字段可选） */
export type UpdateAgentDto = Partial<CreateAgentDto>;

export { AgentConfig };
