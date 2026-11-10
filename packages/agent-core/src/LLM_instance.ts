import { readConfigByAgentName, readConfigByModelName } from './readConfig.js';
import { initStreamModel } from './agents.js';

/**
 * LangChain + model 配置实现大模型实例创建
 * @param agentName 智能体名称
 */
export async function createModel(agentName: string) {
  // 1. 读取到 agents 智能体的相关配置（config）
  const agentconfig = readConfigByAgentName(agentName);

  // 2. 从 agentconfig 中读取出该智能体使用的模型名称
  const model = agentconfig.model;
  // 从 models 配置文件中读取出该模型的相关配置（config）
  const modelconfig = readConfigByModelName(model);

  // 3. 初始化模型
  const Model = await initStreamModel(modelconfig);

  return Model;
}

// 如果其他模块需要引用该函数，则这条测试语句一定要注释掉，否则会报错
// createModel('TestAgent');