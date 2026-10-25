import { Controller, Query, Get, Res } from "@nestjs/common";
import { createModel } from "@makefile-claw/agent-core";
import { ModelsService } from "./models.service.js";

@Controller("models-streaming")
export class ModelsLangchainController {
  constructor(private readonly modelsService: ModelsService) {}

  /**
   * 流式大模型接口
   * @param query 请求入参，携带 input 用户提问
   * @param res Nest 原生响应对象，用于 SSE 流式输出（长连接通道）
   */
  @Get()
  async test(@Query() query: any, @Res() res: any) {
    // 校验入参，用户提问不能为空
    if (!query.input) {
      return "input is required";
    } else {
      try {
        // 设置响应头：纯文本流、utf8编码，前端持续接收分片文本
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');

        let { input } = query;
        // 解码url参数并去除首尾空格
        input = decodeURIComponent(input).trim();
        
        // 初始化指定 estAgent智能体的模型实例
        const model = await createModel('TestAgent');
        // 发起流式调用，返回异步迭代器
        const response = await model.stream(input);

        let thinking = true;
        console.log('思考中...');
        // for await...of：遍历异步迭代器，接收模型逐块返回的数据分片chunk
        for await (const chunk of response) {
          // 优先输出思考内容（reasoning_content）
          if (thinking) {
            const reasoning = chunk.additional_kwargs?.reasoning_content;
            if (reasoning) {
              // 写入思考片段到响应流
              res.write(String(reasoning));
            } else {
              // 思考段结束，切换到正式回答输出
              thinking = false;
            }
          }
          // 思考结束后，输出模型正文内容
          if (!thinking) {
            const content = typeof chunk.content === 'string' ? chunk.content : '';
            res.write(content);
          }
        }
        // 所有分片推送完成，关闭流
        res.end();
      } catch (error) {
        console.log(error);
        // 异常时关闭响应流，防止前端挂起
        res.end();
      }
    }
  }
}
