import { Module } from '@nestjs/common';
import { ModelsController } from './models.controller.js';
import { ModelsLangchainController } from './models.langchain.controller.js';
import { ModelsService } from './models.service.js';

@Module({
  controllers: [ModelsController, ModelsLangchainController],
  providers: [ModelsService],
})
export class ModelsModule {}
