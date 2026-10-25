import { readConfigByAgentName, readConfigByModelName } from './readConfig.js';
import { initStreamModel } from './agents.js';
import { createModel } from './LLM_instance.js';

export { readConfigByAgentName, readConfigByModelName, initStreamModel, createModel };

/**
 * 创建 LangChain 智能体
 * @param agentName 智能体名称
 */
export async function createAgent(agentName: string) {
  const agentconfig = readConfigByAgentName(agentName);
  if (!agentconfig) {
    throw new Error('智能体不存在');
  }

  const model = agentconfig.model;
  const modelconfig = readConfigByModelName(model);
  if (!modelconfig) {
    throw new Error('模型不存在');
  }

  return initStreamModel(modelconfig);
}

