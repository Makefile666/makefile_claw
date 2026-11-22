import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { TeamsService } from './teams.service.js';
import type { CreateTeamDto, UpdateTeamDto } from './teams.types.js';
import { success, type ApiResponse } from '../common/response.js';
import type { TeamConfig } from '../claw-config/claw-config.types.js';

@Controller('api/teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  findAll(): ApiResponse<TeamConfig[]> {
    return success(this.teamsService.findAll());
  }

  @Get(':name')
  findOne(@Param('name') name: string): ApiResponse<TeamConfig> {
    return success(this.teamsService.findOne(name));
  }

  @Post()
  create(@Body() dto: CreateTeamDto): ApiResponse<TeamConfig> {
    return success(this.teamsService.create(dto), '创建成功');
  }

  @Put(':name')
  update(
    @Param('name') name: string,
    @Body() dto: UpdateTeamDto,
  ): ApiResponse<TeamConfig> {
    return success(this.teamsService.update(name, dto), '更新成功');
  }

  @Delete(':name')
  remove(@Param('name') name: string): ApiResponse<null> {
    this.teamsService.remove(name);
    return success(null, '删除成功');
  }
}
