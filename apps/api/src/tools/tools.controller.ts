import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ToolsService } from './tools.service.js';
import type { CreateToolDto, UpdateToolDto } from './tools.types.js';
import { success, type ApiResponse } from '../common/response.js';
import type { ToolConfig } from '../claw-config/claw-config.types.js';

@Controller('api/tools')
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get()
  findAll(): ApiResponse<ToolConfig[]> {
    return success(this.toolsService.findAll());
  }

  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<ToolConfig> {
    return success(this.toolsService.findOne(name));
  }

  @Post()
  create(@Body() dto: CreateToolDto): ApiResponse<ToolConfig> {
    return success(this.toolsService.create(dto), '创建成功');
  }

  @Put(':name')
  update(
    @Param('name') name: string,
    @Body() dto: UpdateToolDto,
  ): ApiResponse<ToolConfig> {
    return success(this.toolsService.update(name, dto), '更新成功');
  }

  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.toolsService.remove(name);
    return success(null, '删除成功');
  }
}
