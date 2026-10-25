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

  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<AgentConfig> {
    return success(this.agentsService.findOne(name));
  }

  @Post()
  create(@Body() dto: CreateAgentDto): ApiResponse<AgentConfig> {
    return success(this.agentsService.create(dto), '创建成功');
  }

  @Put(':name')
  update(
    @Param('name') name: string,
    @Body() dto: UpdateAgentDto,
  ): ApiResponse<AgentConfig> {
    return success(this.agentsService.update(name, dto), '更新成功');
  }

  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.agentsService.remove(name);
    return success(null, '删除成功');
  }
}
