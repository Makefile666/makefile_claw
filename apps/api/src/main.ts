import { NestFactory } from '@nestjs/core';
import { AppModule, ObserveInstrument } from './app.module.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
  });
  app.enableCors();
  // 增大 JSON 请求体限制，支持图片/文档 base64 上传（默认 100kb 不够）
  // useBodyParser 是 NestExpressApplication 的方法，运行时存在
  (app as any).useBodyParser('json', { limit: '50mb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
