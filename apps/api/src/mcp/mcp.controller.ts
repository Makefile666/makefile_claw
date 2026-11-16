import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { McpService } from './mcp.service.js';
import type { CreateMcpServerDto, UpdateMcpServerDto } from './mcp.types.js';
import { success, type ApiResponse } from '../common/response.js';
import type { McpServerConfig } from '../claw-config/claw-config.types.js';

@Controller('api/mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get()
  findAll(): ApiResponse<McpServerConfig[]> {
    return success(this.mcpService.findAll());
  }

  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<McpServerConfig> {
    return success(this.mcpService.findOne(name));
  }

  @Post()
  create(@Body() dto: CreateMcpServerDto): ApiResponse<McpServerConfig> {
    return success(this.mcpService.create(dto), '创建成功');
  }

  @Put(':name')
  update(
    @Param('name') name: string,
    @Body() dto: UpdateMcpServerDto,
  ): ApiResponse<McpServerConfig> {
    return success(this.mcpService.update(name, dto), '更新成功');
  }

  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.mcpService.remove(name);
    return success(null, '删除成功');
  }
}
