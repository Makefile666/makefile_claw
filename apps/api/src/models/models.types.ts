import type { ModelConfig } from '../claw-config/claw-config.types.js';

/** 创建 Model 时的入参（id 为 LLM 模型标识，由用户填写；不含 createdAt / active 可选） */
export type CreateModelDto = Omit<ModelConfig, 'createdAt' | 'active'> & {
  active?: number;
};

/** 更新 Model 时的入参（所有字段可选） */
export type UpdateModelDto = Partial<CreateModelDto>;

export { ModelConfig };
