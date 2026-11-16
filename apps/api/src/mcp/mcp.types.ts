import type { McpServerConfig } from '../claw-config/claw-config.types.js';

/** 创建 MCP 服务器时的入参（不含 active 可选，默认 0；不含 createdAt/updatedAt，由后端自动填充） */
export type CreateMcpServerDto = Omit<McpServerConfig, 'active' | 'createdAt' | 'updatedAt'> & {
  active?: number;
};

/** 更新 MCP 服务器时的入参（所有字段可选） */
export type UpdateMcpServerDto = Partial<CreateMcpServerDto>;

export { McpServerConfig };
