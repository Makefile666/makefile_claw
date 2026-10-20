import type { AgentConfig } from '../claw-config/claw-config.types.js';

/** 创建 Agent 时的入参（不含 id / createdAt，由服务端生成；active 可选，默认 1） */
export type CreateAgentDto = Omit<AgentConfig, 'id' | 'createdAt' | 'active'> & {
  active?: number;
};

/** 更新 Agent 时的入参（所有字段可选） */
export type UpdateAgentDto = Partial<CreateAgentDto>;

export { AgentConfig };
