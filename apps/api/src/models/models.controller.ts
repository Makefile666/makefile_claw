import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { ModelsService } from './models.service.js';
import type { CreateModelDto, UpdateModelDto } from './models.types.js';
import { success, type ApiResponse } from '../common/response.js';
import type { ModelConfig } from '../claw-config/claw-config.types.js';

@Controller('api/models')
export class ModelsController {
  constructor(private readonly modelsService: ModelsService) {}

  @Get()
  findAll(): ApiResponse<ModelConfig[]> {
    return success(this.modelsService.findAll());
  }

  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<ModelConfig> {
    return success(this.modelsService.findOne(name));
  }

  @Post()
  create(@Body() dto: CreateModelDto): ApiResponse<ModelConfig> {
    return success(this.modelsService.create(dto), '创建成功');
  }

  @Put(':name')
  update(
    @Param('name') name: string,
    @Body() dto: UpdateModelDto,
  ): ApiResponse<ModelConfig> {
    return success(this.modelsService.update(name, dto), '更新成功');
  }

  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.modelsService.remove(name);
    return success(null, '删除成功');
  }
}
