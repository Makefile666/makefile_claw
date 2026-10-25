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

  // // 4. 调用模型，获取流式响应
  // console.log('调用模型...');
  // const response = await Model.stream('你好，你是谁？');

  // let thinking = true;
  // console.log('思考中...');
  // // 专门用来遍历异步迭代器（AsyncIterator），是 JS/TS 处理流式数据的语法，非常适合大模型 SSE 流式返回场景
  // for await (const chunk of response) {
  //   // console.log(chunk);
  //   if (thinking) {
  //     const reasoning = chunk.additional_kwargs?.reasoning_content;
  //     if (reasoning) {
  //       process.stdout.write(String(reasoning));
  //     } else {
  //       console.log();
  //       thinking = false;
  //     }
  //   }
  //   if (!thinking) {
  //     const content = typeof chunk.content === 'string' ? chunk.content : '';
  //     process.stdout.write(content);
  //   }
  // }
}

// 如果其他模块需要引用该函数，则这条测试语句一定要注释掉，否则会报错
// createModel('TestAgent');