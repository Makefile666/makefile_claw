import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { SchedulerService } from './scheduler.service.js';
import type {
  CreateScheduleDto,
  ScheduleConfig,
  UpdateScheduleDto,
} from './scheduler.types.js';
import { success, type ApiResponse } from '../common/response.js';

@Controller('api/schedules')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Get()
  findAll(): ApiResponse<ScheduleConfig[]> {
    return success(this.schedulerService.findAll());
  }

  @Post()
  create(@Body() dto: CreateScheduleDto): ApiResponse<ScheduleConfig> {
    return success(this.schedulerService.create(dto), '创建成功');
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateScheduleDto,
  ): ApiResponse<ScheduleConfig> {
    return success(this.schedulerService.update(id, dto), '更新成功');
  }

  @Delete(':id')
  remove(@Param('id') id: string): ApiResponse<null> {
    this.schedulerService.remove(id);
    return success(null, '删除成功');
  }

  @Post(':id/run')
  async run(
    @Param('id') id: string,
  ): Promise<ApiResponse<{ ok: boolean; summary?: string }>> {
    const result = await this.schedulerService.runNow(id);
    return success(result, result.ok ? '执行完成' : '执行结束（存在异常）');
  }
}
