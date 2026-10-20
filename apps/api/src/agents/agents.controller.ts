import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { AgentsService } from './agents.service.js';
import type { CreateAgentDto, UpdateAgentDto } from './agents.types.js';
import { success, type ApiResponse } from '../common/response.js';
import type { AgentConfig } from '../claw-config/claw-config.types.js';

@Controller('api/agents')
export class AgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Get()
  findAll(): ApiResponse<AgentConfig[]> {
    return success(this.agentsService.findAll());
  }

  @Get(':id')
  findOne(@Param('id') id: string): ApiResponse<AgentConfig> {
    return success(this.agentsService.findOne(id));
  }

  // Nest装饰器：标记这个接口是 POST 请求，路由继承 Controller 上的 /api/agents
  @Post()
  // 创建Agent接口方法
  // @Body()：从http请求body中取出提交的json数据，自动校验并映射到 CreateAgentDto 对象
  // dto：前端提交过来的表单数据
  // 返回类型 ApiResponse<AgentConfig>：统一包装后的响应结构（泛型代表data里面是AgentConfig类型）
  create(@Body() dto: CreateAgentDto): ApiResponse<AgentConfig> {
    // 调用service的create业务方法，生成agent并写入配置文件
    // success() 是我们封装的统一响应工具，包装成 {code:0, data:新建agent对象, msg:"创建成功"}
    return success(this.agentsService.create(dto), '创建成功');
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ): ApiResponse<AgentConfig> {
    return success(this.agentsService.update(id, dto), '更新成功');
  }

  @Delete(':id')
  remove(@Param('id') id: string): ApiResponse<null> {
    this.agentsService.remove(id);
    return success(null, '删除成功');
  }
}
